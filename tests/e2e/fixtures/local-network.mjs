// Test-only transport: never open a socket outside loopback. When requested,
// serve the default API origin through a local HTTP fixture without DNS/TLS.
import net from "node:net";
import { Agent, setGlobalDispatcher } from "undici";

const connect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function (...args) {
  const first = Array.isArray(args[0]) ? args[0][0] : args[0];
  const host = typeof first === "object" ? first.host : args[1];
  if (!["127.0.0.1", "::1"].includes(host)) {
    console.error("LOCAL_NETWORK_ONLY: blocked socket");
    throw new Error(
      "LOCAL_NETWORK_ONLY: only explicit loopback sockets are allowed",
    );
  }
  return connect.apply(this, args);
};

setGlobalDispatcher(
  new Agent({
    connect(options, callback) {
      let port;
      if (
        options.hostname === "api.rollbar.com" &&
        options.protocol === "https:" &&
        (!options.port || String(options.port) === "443") &&
        process.env.MCP_TEST_API_PORT
      ) {
        port = Number(process.env.MCP_TEST_API_PORT);
      } else if (
        ["localhost", "127.0.0.1", "[::1]", "::1"].includes(options.hostname) &&
        options.protocol === "http:"
      ) {
        port = Number(options.port);
      } else {
        console.error("LOCAL_NETWORK_ONLY: blocked endpoint");
        callback(
          new Error(
            "LOCAL_NETWORK_ONLY: endpoint not mapped to a local fixture",
          ),
          null,
        );
        return;
      }
      const socket = net.connect({ host: "127.0.0.1", port });
      const onError = (error) => callback(error, null);
      socket.once("error", onError);
      socket.once("connect", () => {
        socket.removeListener("error", onError);
        callback(null, socket);
      });
    },
  }),
);
