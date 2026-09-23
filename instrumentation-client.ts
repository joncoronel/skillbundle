import { initBotId } from "botid/client/core";

// Vercel BotID, checked by `checkBotId()` on the server. `POST /` is the
// signed-out repo match: a server action POSTs to the page that calls it. If
// the repo input moves to another page, add that path or it reads as a bot.
initBotId({
  protect: [{ path: "/", method: "POST" }],
});
