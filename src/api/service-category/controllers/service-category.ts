import { factories } from "@strapi/strapi";

export default factories.createCoreController(
    "api::service-category.service-category",
    ({ strapi }) => ({

        async find(ctx) {
            ctx.query.populate = {
                image: true,
            };

            return await strapi
                .service("api::service-category.service-category")
                .find(ctx.query);
        },

        async findOne(ctx) {
            return await strapi
                .documents("api::service-category.service-category")
                .findOne({
                    documentId: ctx.params.id,
                    populate: {
                        image: true,
                    },
                });
        },

        async create(ctx) {
            const body = ctx.request.body?.data || ctx.request.body;

            return await strapi
                .documents("api::service-category.service-category")
                .create({
                    data: body,
                    populate: {
                        image: true,
                    },
                });
        },

        async update(ctx) {
            const body = ctx.request.body?.data || ctx.request.body;
            console.log(ctx.params)
            return await strapi
                .documents("api::service-category.service-category")
                .update({
                    documentId: ctx.params.id,
                    data: body,
                    populate: {
                        image: true,
                    },
                });
        },
    })
);