import { Server } from "socket.io";

let io: Server;

export const initSocket = (httpServer: any) => {
  io = new Server(httpServer, {
    cors: {
      origin: "*",
      methods: ["GET", "POST", "PUT", "DELETE"],
    },
  });

  io.on("connection", (socket) => {
    console.log("Socket Connected:", socket.id);

    socket.on("join-order", (orderDocumentId: string) => {
      socket.join(`order-${orderDocumentId}`);
    });

    socket.on("leave-order", (orderDocumentId: string) => {
      socket.leave(`order-${orderDocumentId}`);
    });

    socket.on("disconnect", () => {
      console.log("Socket Disconnected:", socket.id);
    });
  });
};

export const getIO = () => io;