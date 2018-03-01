const WebSocket = require('ws');
const request = require('request');

const JOIN_ROOM = "JOIN_ROOM";
const SET_ROOM_CONFIG = "SET_ROOM_CONFIG";
const PORT = 10050;
const ROOM_DEFAULT_CONFIG = {
  "tl": "",
  "bl": "",
  "tr": "",
  "br": ""
};

const idGenerator = (function () {
  let nextId = 1;
  return function () {
    return nextId++;
  }
})();

function doAcceptAuthHuh(connection) {
  // This is the place in the code where you can require login from a particular google apps domains
  return connection.authDomain === "hubspot.com";
}

function authenticate(connection, token) {
  const options = {
    url: 'https://www.googleapis.com/plus/v1/people/me',
    headers: {
      'Authorization': `Bearer ${token}`
    }
  };

  request(options, function (error, response, body) {
    const result = JSON.parse(body);
    connection.displayName = result.displayName;
    connection.profilePicture = result.image.url;
    connection.authDomain = result.domain;
    connection.authStatus = doAcceptAuthHuh(connection);
    log(connection, `Auth completed (accepted: ${connection.authStatus})`);
    connection.send(JSON.stringify({
      "type": "AUTH_CHANGE",
      authStatus: connection.authStatus,
      displayName: connection.displayName,
    }))
  });
}

function log(connection, message) {
  const username = connection.displayName ? " - " + connection.displayName : "";
  console.log(`[${connection.id}${username}] ${message}`);
}

const wss = new WebSocket.Server({port: PORT});

const rooms = {};

function ensureRoom(room) {
  if (rooms[room] === undefined) {
    rooms[room] = {
      config: ROOM_DEFAULT_CONFIG,
      members: [],
    };
  }
}

function sendToConnection(connection, message) {
  connection.send(JSON.stringify(message));
  log(connection, `Sent message to directly`);
}

function broadcastToAllInRoom(room, sourceConnection, message) {
  const members = rooms[room].members;
  for (let i = 0; i < members.length; i++) {
    message.ownFeedback = members[i] === sourceConnection;
    members[i].send(JSON.stringify(message));
    log(members[i], `Sent message to because of room broadcast`);
  }
}

function leaveCurrentRoom(connection) {
  if (!connection.room) {
    return;
  }
  ensureRoom(connection.room);
  log(connection, `Left room ${connection.room}`);
  rooms[connection.room].members.splice(rooms[connection.room].members.indexOf(connection), 1);
  connection.room = null;
}

function joinRoom(connection, room) {
  ensureRoom(room);
  rooms[room].members.push(connection);
  connection.room = room;
  sendToConnection(connection, {
    "type": "CONFIG_CHANGE",
    "config": rooms[room].config,
    "who": "ROOM_JOIN",
    "ownFeedback": true,
  });
  log(connection, `Joined room ${room}`);
}

function setRoomConfig(room, config, connection) {
  ensureRoom(room);
  rooms[room].config = config;
  broadcastToAllInRoom(room, connection, {
    "type": "CONFIG_CHANGE",
    "config": config,
    "who": connection.displayName,
  });
  log(connection, `Set the room config for room ${room} to ${JSON.stringify(config)}`);
}

function handleMessage(message, connection) {
  if (message.type === "JOIN_ROOM") {
    log(connection, "Received JOIN_ROOM message");
    leaveCurrentRoom(connection);
    joinRoom(connection, message.room);
  } else if (message.type === "AUTH") {
    log(connection, "Received AUTH message");
    authenticate(connection, message.token);
  } else if (message.type === "SET_ROOM_CONFIG") {
    log(connection, "Received SET_ROOM_CONFIG message");
    if (!connection.authStatus) {
      log(connection, "Attempted to SET_ROOM_CONFIG without a valid auth");
      return;
    }
    setRoomConfig(connection.room, message.config, connection);
  } else {
    log(connection, "Received unknown message");
  }
}

wss.on('connection', function connection(ws) {
  ws.id = idGenerator();
  ws.authStatus = false;
  log(ws, "Connected");
  ws.on('message', function incoming(rawMessage) {
    const message = JSON.parse(rawMessage);
    handleMessage(message, ws);
  });
  ws.on('close', function () {
    leaveCurrentRoom(ws);
    log(ws, "Disconnected");
  });
  ws.on("error", function (err) {
    console.warn("Caught connection error but ignoring...", err);
  });
});
