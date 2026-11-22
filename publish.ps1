# Publishes duostream to GitHub: uploads the source, builds a signed installer and creates a
# release with latest.json (which the in-app updater reads).
#
#   $env:GITHUB_TOKEN = "<token with repo access>"; .\publish.ps1
#
# The updater signing key lives outside the repo in %USERPROFILE%\.duostream-keys (never commit it).
param([string]$Owner = "0neBeerLeft", [string]$Repo = "duostream", [string]$Notes = "", [switch]$SkipBuild)
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot
$token = $env:GITHUB_TOKEN
if (-not $token) { throw "Set `$env:GITHUB_TOKEN first." }
$H = @{ Authorization = "Bearer $token"; "User-Agent" = "duostream-publish"; Accept = "application/vnd.github+json" }
$api = "https://api.github.com/repos/$Owner/$Repo"
function Invoke-Gh($method, $url, $body) {
  $json = if ($null -ne $body) { $body | ConvertTo-Json -Depth 20 -Compress } else { $null }
  Invoke-RestMethod -Method $method -Uri $url -Headers $H -Body $json -ContentType "application/json"
}

# 1. repo (public, so the app can download updates and plugins)
try { Invoke-Gh Get $api $null | Out-Null } catch {
  Write-Host "Creating github.com/$Owner/$Repo ..."
  Invoke-Gh Post "https://api.github.com/user/repos" @{ name = $Repo; private = $false; auto_init = $true; description = "Twitch + Kick in one fast native desktop app" } | Out-Null
  Start-Sleep 3
}

# the version lives in Cargo.toml only (tauri.conf.json takes it from there)
$version = ((Select-String -Path Cargo.toml -Pattern '^version\s*=\s*"([^"]+)"' | Select-Object -First 1).Matches[0].Groups[1].Value)
if (-not $version) { throw "No version found in Cargo.toml" }
$tag = "v$version"

# 2. signed build
if (-not $SkipBuild) {
  $kd = Join-Path $env:USERPROFILE ".duostream-keys"
  $env:TAURI_SIGNING_PRIVATE_KEY = [System.IO.File]::ReadAllText("$kd\updater.key").Trim()
  $env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = [System.IO.File]::ReadAllText("$kd\updater.password").Trim()
  $env:PATH = "$env:USERPROFILE\.cargo\bin;$env:PATH"
  Get-Process duostream -ErrorAction SilentlyContinue | Stop-Process -Force
  cargo tauri build
  if ($LASTEXITCODE -ne 0) { throw "build failed" }
}
$setup = Get-Item "target\release\bundle\nsis\duostream_${version}_x64-setup.exe"
$sig = Get-Item "$($setup.FullName).sig"

# 3. source upload (one commit with every tracked file)
Write-Host "Uploading source ..."
$exclude = '^(target|gen|\.git)[\\/]|\.key$|\.password$'
$files = Get-ChildItem -Recurse -File | ForEach-Object { $_.FullName.Substring($PSScriptRoot.Length + 1) } | Where-Object { $_ -notmatch $exclude }
$tree = foreach ($f in $files) {
  $b64 = [Convert]::ToBase64String([System.IO.File]::ReadAllBytes((Join-Path $PSScriptRoot $f)))
  $blob = Invoke-Gh Post "$api/git/blobs" @{ content = $b64; encoding = "base64" }
  @{ path = $f.Replace('\', '/'); mode = "100644"; type = "blob"; sha = $blob.sha }
}
$head = Invoke-Gh Get "$api/git/ref/heads/main" $null
$newTree = Invoke-Gh Post "$api/git/trees" @{ tree = @($tree) }
$commit = Invoke-Gh Post "$api/git/commits" @{ message = "duostream $tag"; tree = $newTree.sha; parents = @($head.object.sha) }
Invoke-Gh Patch "$api/git/refs/heads/main" @{ sha = $commit.sha; force = $true } | Out-Null
Write-Host "  $($files.Count) files committed"

# 4. release + assets
$rel = try { Invoke-Gh Get "$api/releases/tags/$tag" $null } catch { $null }
if (-not $rel) {
  $rel = Invoke-Gh Post "$api/releases" @{ tag_name = $tag; target_commitish = "main"; name = "duostream $version"; body = $(if ($Notes) { $Notes } else { "duostream $version" }) }
}
$base = "https://github.com/$Owner/$Repo/releases/download/$tag"
$latest = @{
  version = $version; notes = $rel.body; pub_date = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
  platforms = @{ "windows-x86_64" = @{ signature = [System.IO.File]::ReadAllText($sig.FullName).Trim(); url = "$base/$($setup.Name)" } }
}
$latestPath = Join-Path $env:TEMP "latest.json"
[System.IO.File]::WriteAllText($latestPath, ($latest | ConvertTo-Json -Depth 5))
foreach ($a in @($setup.FullName, $sig.FullName, $latestPath)) {
  $name = Split-Path $a -Leaf
  $old = $rel.assets | Where-Object { $_.name -eq $name }
  if ($old) { Invoke-Gh Delete "$api/releases/assets/$($old.id)" $null | Out-Null }
  $up = $rel.upload_url -replace '\{.*\}', "?name=$name"
  Invoke-RestMethod -Method Post -Uri $up -Headers $H -InFile $a -ContentType "application/octet-stream" | Out-Null
  Write-Host "  uploaded $name"
}
Write-Host "Done: https://github.com/$Owner/$Repo/releases/tag/$tag"
