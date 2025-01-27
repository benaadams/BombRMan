(function ($, window) {
    var MAP_WIDTH = 15,
        MAP_HEIGHT = 13,
        TILE_SIZE = 32,
        keyState = {},
        prevKeyState = {},
        inputId = 0,
        lastSentInputId = 0,
        lastProcessed = 0,
        lastProcessedTime = 0,
        lastProcessedRTT = 0,
        serverStats,
        inputs = [];


    function empty(state) {
        for (var key in window.Game.Keys) {
            if (state[window.Game.Keys[key]] === true) {
                return false;
            }
        }
        return true;
    }

    window.Game.Engine = function (assetManager) {
        this.gameServer = new window.signalR.HubConnectionBuilder()
            .withUrl('/game')
            .build();

        this.assetManager = assetManager;
        this.players = {};
        this.ticks = 0;
        this.map = new window.Game.Map(MAP_WIDTH, MAP_HEIGHT, TILE_SIZE);
        this.sprites = [];
        this.inputManager = {
            isKeyDown: function (key) {
                return keyState[key] === true;
            },
            isKeyUp: function (key) {
                return keyState[key] === false;
            },
            isHoldingKey: function (key) {
                return prevKeyState[key] === true &&
                    keyState[key] === true;
            },
            isKeyPress: function (key) {
                return prevKeyState[key] === false &&
                    keyState[key] === true;
            },
            isKeyRelease: function (key) {
                return prevKeyState[key] === true &&
                    keyState[key] === false;
            }
        };

        for (var key in window.Game.Keys) {
            keyState[window.Game.Keys[key]] = false;
            prevKeyState[window.Game.Keys[key]] = false;
        }

        this.types = {
            GRASS: 0,
            WALL: 2,
            BRICK: 3,
        };
    };

    window.Game.Engine.prototype = {
        onKeydown: function (e) {
            keyState[e.keyCode] = true;
        },
        onKeyup: function (e) {
            keyState[e.keyCode] = false;
        },
        onExplosionEnd: function (x, y) {
            var randomPower = Math.floor(Math.random() * window.Game.Powerups.EXPLOSION) + window.Game.Powerups.SPEED;

            if (this.map.get(x, y) === this.types.BRICK) {
                this.map.set(x, y, this.types.GRASS);

                this.addSprite(new window.Game.Powerup(x, y, 5, randomPower));
            }
        },
        onExplosion: function (x, y) {
            for (var i = 0; i < this.sprites.length; ++i) {
                var sprite = this.sprites[i];
                if (sprite.explode && sprite.x === x && sprite.y === y) {
                    sprite.explode(this);
                }
            }
        },
        getSpritesAt: function (x, y) {
            var sprites = [];
            for (var i = 0; i < this.sprites.length; ++i) {
                var sprite = this.sprites[i];
                if (sprite.x === x && sprite.y === y) {
                    sprites.push(sprite);
                }
            }
            return sprites;
        },
        canDestroy: function (x, y) {
            var tile = this.map.get(x, y);
            return tile === this.types.BRICK || tile === this.types.GRASS;
        },
        addSprite: function (sprite) {
            this.sprites.push(sprite);
            this.sprites.sort(function (a, b) {
                return a.order - b.order;
            });
        },
        removeSprite: function (sprite) {
            var index = window.Game.Utils.indexOf(this.sprites, sprite);
            if (index !== -1) {
                this.sprites.splice(index, 1);
                this.sprites.sort(function (a, b) {
                    return a.order - b.order;
                });
            }
        },
        sendKeyState: function () {
            var player = this.players[this.playerIndex];

            if (!(empty(prevKeyState) && empty(keyState))) {
                inputs.push({ keyState: $.extend({}, keyState), id: inputId++, time: performance.now() });
            }

            // TODO: Handle connected state
            // if ($.connection.hub.state === $.signalR.connectionState.connected) {
            //var gameServer = $.connection.gameServer,
            //$.connection.hub.transport.name !== 'webSockets' ?
            //   Math.max(1, Math.floor(window.Game.TicksPerSecond / 5)) : 
            var updateTick = 1;

            if (this.ticks % updateTick === 0) {
                var buffer = inputs.splice(0, inputs.length);
                if (buffer.length > 0) {
                    this.gameServer.invoke('sendKeys', buffer);
                    lastSentInputId = buffer[buffer.length - 1].id;
                }
            }
            //}
        },
        initialize: function () {
            var that = this;

            this.gameServer.on('initializeMap', function (data) {
                that.map.fill(data);
            });

            this.gameServer.on('initializePlayer', function (player) {
                var bomber = new window.Game.Bomber();
                that.playerIndex = player.index;
                that.players[player.index] = bomber;
                bomber.moveTo(player.x, player.y);
                that.addSprite(bomber);


                // Create a ghost
                var ghost = new window.Game.Bomber(false);
                ghost.transparent = true;
                that.ghost = ghost;
                ghost.moveTo(player.x, player.y);
                that.addSprite(ghost);
            });

            this.gameServer.on('playerLeft', function (player) {
                var bomber = that.players[player.index];
                if (bomber) {
                    that.removeSprite(bomber);
                    that.players[player.index] = null;
                }
            });

            this.gameServer.on('initialize', function (players) {
                for (var i = 0; i < players.length; ++i) {
                    var player = players[i];
                    if (that.players[player.index]) {
                        continue;
                    }

                    var bomber = new window.Game.Bomber(false);
                    that.players[player.index] = bomber;
                    bomber.moveTo(players[i].x, players[i].y);
                    that.addSprite(bomber);
                }
            });

            this.gameServer.on('updatePlayerState', function (player) {
                var sprite = null;
                if (player.index === that.playerIndex) {
                    sprite = that.ghost;
                    lastProcessed = player.lastProcessed;
                    lastProcessedTime = player.lastProcessedTime;
                }
                else {
                    sprite = that.players[player.index];
                }

                if (sprite) {
                    // Brute force
                    sprite.x = player.x;
                    sprite.y = player.y;
                    sprite.exactX = player.exactX;
                    sprite.exactY = player.exactY;
                    sprite.direction = player.direction;
                    sprite.directionX = player.directionX;
                    sprite.directionY = player.directionY;
                    sprite.updateAnimation(that);
                }
            });

            this.gameServer.on('serverStats', stats => {
                serverStats = stats;
            });

            // $.connection.hub.logging = true;
            // $.connection.hub.url = 'http://localhost:8081/signalr';
            // $.connection.hub.start();
            this.gameServer.start();
        },
        update: function () {
            this.ticks++;
            this.sendKeyState();

            if (this.inputManager.isKeyPress(window.Game.Keys.D)) {
                window.Game.Debugging = !window.Game.Debugging;
            }

            if (this.inputManager.isKeyPress(window.Game.Keys.P)) {
                window.Game.MoveSprites = !window.Game.MoveSprites;
            }

            for (var i = 0; i < this.sprites.length; ++i) {
                var sprite = this.sprites[i];
                if (sprite.update) {
                    sprite.update(this);
                }
            }

            for (var key in keyState) {
                prevKeyState[key] = keyState[key];
            }

            window.Game.Logger.log('last input = ' + (inputId - 1));
            window.Game.Logger.log('last sent input = ' + lastSentInputId);
            window.Game.Logger.log('last server processed input = ' + lastProcessed);
            if (lastProcessed < lastSentInputId) {
                lastProcessedRTT = performance.now() - lastProcessedTime;
            }
            window.Game.Logger.log('last server processed input time (ms) = ' + lastProcessedRTT);
            window.Game.Logger.log('serverStats:' + JSON.stringify(serverStats));
        },
        movable: function (x, y) {
            if (y >= 0 && y < MAP_HEIGHT && x >= 0 && x < MAP_WIDTH) {
                if (this.map.get(x, y) === this.types.GRASS) {
                    for (var i = 0; i < this.sprites.length; ++i) {
                        var sprite = this.sprites[i];
                        if (sprite.x === x && sprite.y === y && sprite.type === window.Game.Sprites.BOMB) {
                            return false;
                        }
                    }

                    return true;
                }
            }

            return false;
        }

    };

})(jQuery, window);