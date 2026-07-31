"use strict";

module.exports = {
  routes: [
    {
      method: "POST",
      path: "/google-signup",
      handler: "google-signup.googleSignup",
      config: {
        auth: false,
      },
    },
  ],
};