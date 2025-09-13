const WebSocket = require('ws');
const http = require('http');

// Create HTTP server
const server = http.createServer();
const wss = new WebSocket.Server({ server });

// Game rooms storage
const gameRooms = new Map();

class GameRoom {
    constructor(roomCode) {
        this.roomCode = roomCode;
        this.host = null;
        this.players = [];
        this.gameStarted = false;
        this.gameEnded = false;
        this.gameTimer = 300; // 5 minutes
        this.timerInterval = null;
        this.questions = [
            {
                question: "What does HTML stand for?",
                alternatives: ["Hyper Text Markup Language", "Home Tool Markup Language", "Hyperlinks and Text Markup Language", "Hyper Tool Multi Language"],
                correct: 0
            },
            {
                question: "Which CSS property is used to change the text color?",
                alternatives: ["text-color", "font-color", "color", "text-style"],
                correct: 2
            },
            {
                question: "What does CSS stand for?",
                alternatives: ["Creative Style Sheets", "Cascading Style Sheets", "Computer Style Sheets", "Colorful Style Sheets"],
                correct: 1
            },
            {
                question: "Which HTML tag is used to create a hyperlink?",
                alternatives: ["<link>", "<a>", "<href>", "<url>"],
                correct: 1
            },
            {
                question: "What is the correct way to write a JavaScript array?",
                alternatives: ["var colors = 'red', 'green', 'blue'", "var colors = (1:'red', 2:'green', 3:'blue')", "var colors = ['red', 'green', 'blue']", "var colors = 1 = ('red'), 2 = ('green'), 3 = ('blue')"],
                correct: 2
            },
            {
                question: "Which event occurs when the user clicks on an HTML element?",
                alternatives: ["onchange", "onclick", "onmouseclick", "onmouseover"],
                correct: 1
            },
            {
                question: "What does DOM stand for?",
                alternatives: ["Document Object Model", "Display Object Management", "Dynamic Object Model", "Document Oriented Model"],
                correct: 0
            },
            {
                question: "Which method is used to add an element at the end of an array?",
                alternatives: ["push()", "add()", "append()", "insert()"],
                correct: 0
            },
            {
                question: "What is the correct way to write a CSS comment?",
                alternatives: ["// this is a comment", "/* this is a comment */", "<!-- this is a comment -->", "* this is a comment *"],
                correct: 1
            },
            {
                question: "Which HTML attribute specifies an alternate text for an image?",
                alternatives: ["title", "src", "alt", "longdesc"],
                correct: 2
            }
        ];
    }

    addPlayer(player, ws) {
        player.ws = ws;
        this.players.push(player);
        this.broadcastToAll('player_joined', { players: this.getPlayersData() });
    }

    removePlayer(playerId) {
        this.players = this.players.filter(player => player.id !== playerId);
        this.broadcastToAll('player_joined', { players: this.getPlayersData() });
    }

    setHost(ws) {
        this.host = ws;
    }

    startGame() {
        this.gameStarted = true;
        this.startTimer();
        this.broadcastToAll('game_started', {});
    }

    startTimer() {
        this.timerInterval = setInterval(() => {
            this.gameTimer--;
            this.broadcastToHost('timer_update', { timeLeft: this.gameTimer });
            
            if (this.gameTimer <= 0) {
                this.endGame();
            }
        }, 1000);
    }

    updatePlayerScore(playerId, newScore) {
        const player = this.players.find(p => p.id === playerId);
        if (player) {
            player.score = newScore;
            this.broadcastToHost('leaderboard_update', { players: this.getPlayersData() });
        }
    }

    finishPlayer(playerId, finalScore) {
        const player = this.players.find(p => p.id === playerId);
        if (player) {
            player.finished = true;
            player.score = finalScore;
        }

        // Check if all players finished
        if (this.players.every(p => p.finished)) {
            setTimeout(() => {
                this.endGame();
            }, 2000);
        }
    }

    endGame() {
        this.gameEnded = true;
        if (this.timerInterval) {
            clearInterval(this.timerInterval);
        }

        const sortedPlayers = [...this.players].sort((a, b) => b.score - a.score);
        this.broadcastToAll('game_ended', {
            finalResults: {
                players: this.getPlayersData()
            }
        });
    }

    restartGame() {
        this.gameStarted = false;
        this.gameEnded = false;
        this.gameTimer = 300;
        if (this.timerInterval) {
            clearInterval(this.timerInterval);
        }
        
        // Reset all players
        this.players.forEach(player => {
            player.score = 0;
            player.answeredQuestions = 0;
            player.finished = false;
        });
    }

    getPlayersData() {
        return this.players.map(player => ({
            id: player.id,
            name: player.name,
            school: player.school,
            city: player.city,
            score: player.score,
            answeredQuestions: player.answeredQuestions,
            finished: player.finished
        }));
    }

    broadcastToAll(type, data) {
        const message = JSON.stringify({ type, ...data });
        
        // Send to host
        if (this.host && this.host.readyState === WebSocket.OPEN) {
            this.host.send(message);
        }
        
        // Send to all players
        this.players.forEach(player => {
            if (player.ws && player.ws.readyState === WebSocket.OPEN) {
                player.ws.send(message);
            }
        });
    }

    broadcastToHost(type, data) {
        if (this.host && this.host.readyState === WebSocket.OPEN) {
            const message = JSON.stringify({ type, ...data });
            this.host.send(message);
        }
    }

    broadcastToPlayers(type, data) {
        const message = JSON.stringify({ type, ...data });
        this.players.forEach(player => {
            if (player.ws && player.ws.readyState === WebSocket.OPEN) {
                player.ws.send(message);
            }
        });
    }
}

// Generate room code
function generateRoomCode() {
    return Math.random().toString(36).substring(2, 8).toUpperCase();
}

// WebSocket connection handler
wss.on('connection', function connection(ws) {
    console.log('New WebSocket connection established');
    
    let currentRoom = null;
    let playerId = null;
    let isHost = false;

    ws.on('message', function incoming(message) {
        try {
            const data = JSON.parse(message);
            console.log('Received:', data.type);

            switch (data.type) {
                case 'create_room':
                    const roomCode = generateRoomCode();
                    const room = new GameRoom(roomCode);
                    room.setHost(ws);
                    gameRooms.set(roomCode, room);
                    currentRoom = room;
                    isHost = true;
                    
                    ws.send(JSON.stringify({
                        type: 'room_created',
                        roomCode: roomCode
                    }));
                    console.log(`Room created: ${roomCode}`);
                    break;

                case 'join_game':
                    // For simplicity, auto-join the most recent room
                    // In production, you'd want room codes
                    const availableRoom = Array.from(gameRooms.values()).find(room => !room.gameStarted);
                    
                    if (availableRoom) {
                        currentRoom = availableRoom;
                        playerId = data.player.id;
                        availableRoom.addPlayer(data.player, ws);
                        console.log(`Player ${data.player.name} joined room ${availableRoom.roomCode}`);
                    } else {
                        ws.send(JSON.stringify({
                            type: 'error',
                            message: 'No available rooms found'
                        }));
                    }
                    break;

                case 'start_game':
                    if (currentRoom && isHost) {
                        currentRoom.startGame();
                        console.log(`Game started in room ${currentRoom.roomCode}`);
                    }
                    break;

                case 'answer_submitted':
                    if (currentRoom && data.isCorrect) {
                        currentRoom.updatePlayerScore(data.playerId, data.newScore);
                    }
                    break;

                case 'player_finished':
                    if (currentRoom) {
                        currentRoom.finishPlayer(data.playerId, data.finalScore);
                    }
                    break;

                case 'restart_game':
                    if (currentRoom && isHost) {
                        currentRoom.restartGame();
                        console.log(`Game restarted in room ${currentRoom.roomCode}`);
                    }
                    break;
            }
        } catch (error) {
            console.error('Error processing message:', error);
            ws.send(JSON.stringify({
                type: 'error',
                message: 'Invalid message format'
            }));
        }
    });

    ws.on('close', function() {
        console.log('WebSocket connection closed');
        
        if (currentRoom) {
            if (isHost) {
                // Host disconnected, clean up room
                if (currentRoom.timerInterval) {
                    clearInterval(currentRoom.timerInterval);
                }
                gameRooms.delete(currentRoom.roomCode);
                console.log(`Room ${currentRoom.roomCode} deleted - host disconnected`);
            } else if (playerId) {
                // Player disconnected
                currentRoom.removePlayer(playerId);
                console.log(`Player ${playerId} disconnected from room ${currentRoom.roomCode}`);
            }
        }
    });

    ws.on('error', function(error) {
        console.error('WebSocket error:', error);
    });
});

const PORT = process.env.PORT || 3001;

server.listen(PORT, function listening() {
    console.log(`Quiz Game WebSocket Server running on port ${PORT}`);
    console.log(`WebSocket endpoint: ws://localhost:${PORT}`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
    console.log('Shutting down gracefully...');
    server.close(() => {
        console.log('Server closed');
        process.exit(0);
    });
});

process.on('SIGINT', () => {
    console.log('Shutting down gracefully...');
    server.close(() => {
        console.log('Server closed');
        process.exit(0);
    });
});