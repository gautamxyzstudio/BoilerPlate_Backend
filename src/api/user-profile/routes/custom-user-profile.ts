export default {
  routes: [
    {
      method: "PUT",
      path: "/user-profiles/me",
      handler: "user-profile.updateMe",
      config: {
        auth: {}
      },
    },
  ],
};