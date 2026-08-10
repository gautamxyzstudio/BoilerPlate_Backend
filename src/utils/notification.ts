export const createNotification = async ({
  strapi,
  title,
  description,
  type,
}: {
  strapi: any;
  title: string;
  description: string;
  type: "user" | "order";
}) => {
  return await strapi.entityService.create(
    "api::notification.notification",
    {
      data: {
        title,
        description,
        type,
        publishedAt: new Date(),
      },
    },
  );
};