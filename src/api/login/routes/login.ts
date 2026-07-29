export default {
  routes: [
    {
      method: "POST",
      path: "/auth/login",
      handler: "login.login",
      config: {
        auth: false,
      },
    },
  ],
};