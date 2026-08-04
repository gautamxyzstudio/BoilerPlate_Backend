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
    {
      method: "POST",
      path: "/create-user-manually",
      handler: "user-profile.customerCreatedByAdmin",
      config: {
        auth: {}
      },
    },
    
  ],
};