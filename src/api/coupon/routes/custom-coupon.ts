export default {
  routes: [
    {
      method: "POST",
      path: "/coupons/apply",
      handler: "coupon.apply",
      config: {
        auth: false,
        policies: [],
        middlewares: [],
      },
    },
    {
      method: "POST",
      path: "/coupons/validate",
      handler: "coupon.validate",
      config: {
        auth: false,
        policies: [],
        middlewares: [],
      },
    },
    {
      method: "GET",
      path: "/coupons/available",
      handler: "coupon.getAvailable",
      config: {
        auth: false,
        policies: [],
        middlewares: [],
      },
    },
    {
      method: "POST",
      path: "/coupons/available",
      handler: "coupon.getAvailable",
      config: {
        auth: false,
        policies: [],
        middlewares: [],
      },
    },
    {
      method: "POST",
      path: "/coupons/seed",
      handler: "coupon.seed",
      config: {
        auth: false,
        policies: [],
        middlewares: [],
      },
    },
  ],
};
