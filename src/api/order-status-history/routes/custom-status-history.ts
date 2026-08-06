export default {
  routes: [
    {
      method: "POST",
      path: "/orders/:documentId/update-status",
      handler: "custom-status-history.updateStatus",
      config: {
        auth: {},
      },
    },
  ],
};