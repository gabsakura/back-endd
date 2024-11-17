const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const PORT = 3000;
const SECRET_KEY = 'sua_chave_secreta';

app.use(express.json());
app.use(cors());

// Configura o servidor HTTP e o Socket.IO
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: '*',
        methods: ['GET', 'POST'],
    }
});

// Função para inserir dados no banco e disparar evento
async function addSensorData(newData) {
    return new Promise((resolve, reject) => {
        db.run(
            `INSERT INTO dados_sensores (sensor_id, temperatura, umidade, ocupacao, iluminacao) VALUES (?, ?, ?, ?, ?)`,
            [newData.sensor_id, newData.temperatura, newData.umidade, newData.ocupacao, newData.iluminacao],
            (err) => {
                if (err) {
                    return reject(err);
                }
                console.log('Dados inseridos no banco de dados com sucesso.');
                io.emit('sensorDataUpdate', newData); // Emitindo os dados atualizados
                resolve();
            }
        );
    });
}

// Escuta a conexão de clientes
io.on('connection', (socket) => {
    console.log('Novo cliente conectado:', socket.id);
    socket.on('disconnect', () => {
        console.log('Cliente desconectado:', socket.id);
    });
});

// Configuração do banco de dados
const db = new sqlite3.Database('banco-de-dados.db');

// Criação das tabelas
db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS usuarios (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE,
        password TEXT
    )`);
    db.run(`CREATE TABLE IF NOT EXISTS dados_sensores (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        sensor_id INTEGER,
        temperatura REAL,
        umidade REAL,
        ocupacao INTEGER,
        iluminacao REAL,
        controle_luz INTEGER DEFAULT 0,  -- 0 para desligado, 1 para ligado
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
});

// Rota para cadastrar um novo usuário
app.post('/register', async (req, res) => {
    const { username, password } = req.body;
    try {
        db.get('SELECT * FROM usuarios WHERE username = ?', [username], async (err, row) => {
            if (row) {
                return res.status(400).json({ message: 'Usuário já existe' });
            }
            const hashedPassword = await bcrypt.hash(password, 10);
            db.run('INSERT INTO usuarios (username, password) VALUES (?, ?)', [username, hashedPassword], (err) => {
                if (err) {
                    console.error('Erro ao cadastrar usuário:', err.message);
                    return res.status(500).json({ message: 'Erro ao cadastrar usuário' });
                }
                res.status(201).json({ message: 'Usuário cadastrado com sucesso' });
            });
        });
    } catch (err) {
        console.error('Erro ao processar o cadastro:', err.message);
        res.status(500).json({ message: 'Erro ao processar o cadastro' });
    }
});

// Rota para login
app.post('/login', (req, res) => {
    const { username, password } = req.body;
    db.get('SELECT * FROM usuarios WHERE username = ?', [username], async (err, row) => {
        if (!row) {
            return res.status(400).json({ message: 'Usuário ou senha incorretos' });
        }
        const isPasswordValid = await bcrypt.compare(password, row.password);
        if (!isPasswordValid) {
            return res.status(400).json({ message: 'Usuário ou senha incorretos' });
        }
        const token = jwt.sign({ userId: row.id }, SECRET_KEY, { expiresIn: '1h' });
        res.json({ message: 'Login realizado com sucesso', token });
    });
});

// Middleware para verificar o token JWT
const authenticateJWT = (req, res, next) => {
    const token = req.headers.authorization && req.headers.authorization.split(' ')[1];
    if (token) {
        jwt.verify(token, SECRET_KEY, (err, user) => {
            if (err) {
                return res.status(403).json({ message: 'Acesso negado' });
            }
            req.user = user;
            next();
        });
    } else {
        res.status(401).json({ message: 'Token não fornecido' });
    }
};

// Rota para buscar todos os dados dos sensores (protegida por JWT)
app.get('/dados-sensores', authenticateJWT, (req, res) => {
    db.all('SELECT * FROM dados_sensores', [], (err, rows) => {
        if (err) {
            console.error('Erro ao buscar dados no banco de dados:', err.message);
            res.status(500).send('Erro ao buscar os dados.');
        } else {
            res.json(rows);
        }
    });
});

// Rota para inserir dados dos sensores
app.post('/dados-sensores', async (req, res) => {
    const dados = req.body;
    console.log('Dados recebidos dos sensores:', dados);
    try {
        await addSensorData(dados);
        res.send('Dados recebidos e armazenados com sucesso.');
    } catch (err) {
        console.error('Erro ao inserir dados no banco de dados:', err.message);
        res.status(500).send('Erro ao processar os dados.');
    }
});

// Rota para controlar o estado do ar condicionado
app.put('/controle-ar/:sensor_id', authenticateJWT, (req, res) => {
    const { sensor_id } = req.params;
    const { estado } = req.body;  // estado = 0 (desligado) ou 1 (ligado)
    
    db.run('UPDATE dados_sensores SET controle_luz = ? WHERE sensor_id = ?', [estado, sensor_id], (err) => {
        if (err) {
            console.error('Erro ao atualizar estado do ar condicionado:', err.message);
            res.status(500).send('Erro ao atualizar o estado do ar condicionado.');
        } else {
            console.log(`Estado do ar condicionado atualizado para ${estado} para o sensor_id ${sensor_id}`);
            io.emit('arStatusUpdate', { sensor_id, estado });  // Emitindo atualização de estado
            res.send(`Estado do ar condicionado atualizado para ${estado}`);
        }
    });
});

// Rota para limpar todos os dados da tabela (protegida por JWT)
app.delete('/limpar-dados', authenticateJWT, (req, res) => {
    db.run('DELETE FROM dados_sensores', [], (err) => {
        if (err) {
            console.error('Erro ao limpar dados do banco de dados:', err.message);
            res.status(500).send('Erro ao limpar os dados.');
        } else {
            console.log('Dados da tabela limpos com sucesso.');
            res.send('Dados da tabela foram limpos com sucesso.');
        }
    });
});

server.listen(PORT, () => {
    console.log(`Servidor rodando em http://localhost:${PORT}`);
});
