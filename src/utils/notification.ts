import { getIO } from "../socket";

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
  // ===============================================
  // Create Notification In Database
  // ===============================================

  const notification = await strapi.entityService.create(
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

  // ===============================================
  // Send Real-time Notification
  // ===============================================

  try {
    const io = getIO();

    io.to("admin-notifications").emit(
      "new-notification",
      notification,
    );
  } catch (error) {
    strapi.log.error(
      "Socket notification error:",
      error,
    );
  }

  return notification;
};