import { createServer } from "node:http";
import next from "next";
import { attachRooms } from "./server/rooms.mjs";

const port = parseInt(process.env.PORT || "3000", 10);
const dev = process.env.NODE_ENV !== "production";

const httpServer = createServer();
const app = next({ dev, port, httpServer });
const handle = app.getRequestHandler();

await app.prepare();
const closeRooms = await attachRooms(httpServer);

httpServer.on("request", (req, res) => {
    handle(req, res);
});

httpServer.listen(port, () => {
    console.log(`> Territorial: ${port}-portda ishlayapti (${dev ? "development" : "production"})`);
});

function shutdown() {
    closeRooms();
    httpServer.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 3000).unref();
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
