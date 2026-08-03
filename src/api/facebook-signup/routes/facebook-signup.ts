export default {
    routes: [
        {
            method: "POST", 
            path: "/facebook-signup",
            handler: "facebook-signup.facebookSignup",
            config: {
                auth: false,
            },
        }
    ]   
}