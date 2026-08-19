export default {
  routes: [
    {
      method: "GET",
      path: "/payment-collections/logs",
      handler: "payment-collection.getAllLogs",
      config: {
        auth: {},
      },
    },
    {
      method: "POST",
      path: "/payment-collections/:documentId/refund",
      handler: "payment-collection.refundPayment",
      config: {
        auth: {},
      },
    },
  ],
};
