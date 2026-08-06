import type { Core } from "@strapi/strapi";
import { initSocket } from "./socket";

export default {
  register(/* { strapi }: { strapi: Core.Strapi } */) {},

  bootstrap({ strapi }: { strapi: Core.Strapi }) {
    initSocket(strapi.server.httpServer);
  },
};