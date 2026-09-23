import { initBotId } from "botid/client/core";

// Vercel BotID. Attaches its challenge headers to the requests listed here,
// which `checkBotId()` then verifies on the server.
//
// `POST /` is the signed-out repo match (`analyzeRepoSignedOut` in
// app/(main)/actions.ts). A server action POSTs to the page that invokes it,
// and the repo input is only mounted on the home page, so the page path is
// what gets protected. BotID matches on the pathname alone, so the `?mode=repo`
// query string doesn't matter. If the repo input is ever mounted on another
// page, add that page's path here, or its signed-out runs will all read as
// bots on Vercel.
initBotId({
  protect: [{ path: "/", method: "POST" }],
});
