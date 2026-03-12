import { createApp } from "./app.js";

const port = Number(process.env.PORT ?? 8787);
const host = process.env.HOST ?? "0.0.0.0";

const { app } = createApp();

app.listen({ port, host }).then(() => {
  console.log(`bridge server listening on http://${host}:${port}`);
});
