/**
 * address controller
 */

import { factories } from "@strapi/strapi";
import userProfile from "../../user-profile/services/user-profile";

export default factories.createCoreController(
    "api::address.address",
    ({ strapi }) => ({

        async create(ctx) {
            const user = ctx.state.user;

            if (!user) {
                return ctx.unauthorized("You must be logged in.");
            }

            const userProfile = await strapi.db
                .query("api::user-profile.user-profile")
                .findOne({
                    where: {
                        users_permissions_user: {
                            id: user.id,
                        },
                    },
                });

            if (!userProfile) {
                return ctx.badRequest("User profile not found.");
            }

            const body = ctx.request.body?.data || ctx.request.body;

            // Check duplicate address
            const duplicateAddress = await strapi.entityService.findMany(
                "api::address.address",
                {
                    filters: {
                        user_profile: {
                            id: userProfile.id,
                        },
                        fullAddress: body.fullAddress,
                        city: body.city,
                        state: body.state,
                        postalCode: body.postalCode,
                        country: body.country,
                    },
                    limit: 1,
                }
            );

            if (duplicateAddress.length > 0) {
                return ctx.badRequest("This address already exists.");
            }

            // Check if the user already has any addresses
            const existingAddresses = await strapi.entityService.findMany(
                "api::address.address",
                {
                    filters: {
                        user_profile: {
                            id: userProfile.id,
                        },
                    },
                    limit: 1,
                }
            );

            const isFirstAddress = existingAddresses.length === 0;

            const entry = await strapi.entityService.create(
                "api::address.address",
                {
                    data: {
                        ...body,
                        user_profile: userProfile.id,
                        isDefaultAddress: isFirstAddress,
                        publishedAt: new Date(),
                    },
                    populate: "*",
                }
            );

            return entry;
        },

        async find(ctx) {
            const user = ctx.state.user;

            if (!user) {
                return ctx.unauthorized("You must be logged in.");
            }

            const userProfile = await strapi.db
                .query("api::user-profile.user-profile")
                .findOne({
                    where: {
                        users_permissions_user: {
                            id: user.id,
                        },
                    },
                });

            if (!userProfile) {
                return ctx.badRequest("User profile not found.");
            }

            const addresses = await strapi.entityService.findMany(
                "api::address.address" as any,
                {
                    filters: {
                        user_profile: userProfile.id,
                    },
                    populate: "*",
                    sort: { createdAt: "desc" },
                }
            );

            return addresses;
        },

        async update(ctx) {
            const user = ctx.state.user;

            if (!user) {
                return ctx.unauthorized("You must be logged in.");
            }

            const userProfile = await strapi.db
                .query("api::user-profile.user-profile")
                .findOne({
                    where: {
                        users_permissions_user: {
                            id: user.id,
                        },
                    },
                });

            if (!userProfile) {
                return ctx.badRequest("User profile not found.");
            }

            const { id } = ctx.params;
            const body = ctx.request.body?.data || ctx.request.body;

            // Find the address
            const address = await strapi.entityService.findOne(
                "api::address.address" as any,
                id,
                {
                    populate: {
                        user_profile: true,
                    },
                }
            );

            if (!address) {
                return ctx.notFound("Address not found.");
            }

            // Ensure the address belongs to the logged-in user
            if ((address.user_profile?.id !== userProfile.id)) {
                return ctx.forbidden("You are not allowed to update this address.");
            }

            // Update the address
            const updatedAddress = await strapi.entityService.update(
                "api::address.address",
                id,
                {
                    data: body,
                    populate: "*",
                }
            );

            return updatedAddress;
        },

        async delete(ctx) {
            console.log("DELETE CONTROLLER HIT");
            const user = ctx.state.user;

            if (!user) {
                return ctx.unauthorized("You must be logged in.");
            }

            const userProfile = await strapi.db
                .query("api::user-profile.user-profile")
                .findOne({
                    where: {
                        users_permissions_user: {
                            id: user.id,
                        },
                    },
                });

            if (!userProfile) {
                return ctx.badRequest("User profile not found.");
            }

            const { id } = ctx.params;

            // Find the address
            const address = await strapi.entityService.findOne(
                "api::address.address" as any,
                id,
                {
                    populate: {
                        user_profile: true,
                    },
                }
            );

            if (!address) {
                return ctx.notFound("Address not found.");
            }

            // Check ownership
            if ((address.user_profile?.id !== userProfile.id)) {
                return ctx.forbidden("You are not allowed to delete this address.");
            }

            // Delete the address
            const deletedAddress = await strapi.entityService.delete(
                "api::address.address",
                id
            );

            return deletedAddress;
        },

        async setDefaultAddress(ctx) {
            const user = ctx.state.user;

            if (!user) {
                return ctx.unauthorized("You must be logged in.");
            }

            const userProfile = await strapi.db
                .query("api::user-profile.user-profile")
                .findOne({
                    where: {
                        users_permissions_user: {
                            id: user.id,
                        },
                    },
                });

            if (!userProfile) {
                return ctx.badRequest("User profile not found.");
            }

            const { id } = ctx.params;

            // Check if the address exists and belongs to the logged-in user
            const address = await strapi.entityService.findOne(
                "api::address.address" as any,
                id,
                {
                    populate: {
                        user_profile: true,
                    },
                }
            );

            if (!address) {
                return ctx.notFound("Address not found.");
            }

            if (address.users_permissions_user?.id !== user.id) {
                return ctx.forbidden(
                    "You are not allowed to set this address as default."
                );
            }

            // Address is already the default
            if (address.isDefaultAddress) {
                return ctx.badRequest("This address is already set as the default address.");
            }

            // Get all addresses of the logged-in user
            const addresses = await strapi.entityService.findMany(
                "api::address.address",
                {
                    filters: {
                        user_profile: userProfile.id,
                    },
                }
            );

            // Remove default from all addresses
            await Promise.all(
                addresses.map((item: any) =>
                    strapi.entityService.update("api::address.address", item.id, {
                        data: {
                            isDefaultAddress: false,
                        },
                    })
                )
            );

            // Set the selected address as default
            const updatedAddress = await strapi.entityService.update(
                "api::address.address",
                id,
                {
                    data: {
                        isDefaultAddress: true,
                    },
                    populate: "*",
                }
            );

            return updatedAddress;
        },

        async getDefaultAddress(ctx) {
            const user = ctx.state.user;

            if (!user) {
                return ctx.unauthorized("You must be logged in.");
            }

            const userProfile = await strapi.db
                .query("api::user-profile.user-profile")
                .findOne({
                    where: {
                        users_permissions_user: {
                            id: user.id,
                        },
                    },
                });

            if (!userProfile) {
                return ctx.badRequest("User profile not found.");
            }

            const addresses = await strapi.entityService.findMany(
                "api::address.address",
                {
                    filters: {
                        user_profile: userProfile.id,
                        isDefaultAddress: true,
                    },
                    populate: "*",
                    limit: 1,
                }
            );

            if (!addresses.length) {
                return ctx.notFound("Default address not found.");
            }

            return addresses[0];
        }

    })
);