export default {
  routes: [
    {
      method: "POST",
      path: "/user/change-password",
      handler: "change-password.changePassword",
      config: {
        auth: {},
      },
    },
  ],
};