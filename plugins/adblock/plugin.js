// Ad Block: removes Twitch's stitched-in ads.
// The filtering itself runs in duostream's local stream proxy, which only filters while this
// plugin is installed and enabled. This script adds the shield button and the "Ad blocked" badge.

const nav = api.addNavButton({
  icon: api.icons.shield,
  title: "Ad block is on",
  active: true,
  onClick: async () => {
    const s = await api.adStatus();
    api.toast(`Ad block is on · ${s.ads_blocked} ad segments removed this session. Turn it off under Plugins.`);
  },
});

const badge = api.addPlayerBadge("Ad blocked");
let timer = null;

function watch(channel) {
  clearInterval(timer);
  badge.show(false);
  if (!channel || channel.platform !== "Twitch") return;
  timer = setInterval(async () => {
    const s = await api.adStatus();
    badge.show(s.ad_break);
    nav.update({ title: `Ad block is on · ${s.ads_blocked} ad segments removed` });
  }, 2000);
}

api.on("channel:open", watch);
api.on("channel:leave", () => watch(null));
watch(api.channel());

api.onUnload(() => clearInterval(timer));
