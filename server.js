const express = require('express');
const cors = require('cors');
const sqlite3 = require('sqlite3');
const { open } = require('sqlite');
const path = require('path');
const bcrypt = require('bcrypt'); // 👈 Importamos bcrypt

const app = express();
app.use(cors());
app.use(express.json());

let db;

// Conectar o crear la Base de Datos automática
(async () => {
  db = await open({
    filename: './barberia.db',
    driver: sqlite3.Database
  });

  // 1. Tabla de citas
  await db.exec(`
    CREATE TABLE IF NOT EXISTS citas (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      cliente TEXT,
      barbero TEXT,
      servicio TEXT,
      fecha TEXT,
      hora TEXT,
      estado TEXT DEFAULT 'Pendiente'
    )
  `);

  // 2. Tabla de barberos
  await db.exec(`
    CREATE TABLE IF NOT EXISTS barberos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nombre TEXT,
      especialidad TEXT,
      experiencia TEXT,
      foto TEXT
    )
  `);

  // 3. Tabla de servicios (Cortes, precios, duración)
  await db.exec(`
    CREATE TABLE IF NOT EXISTS servicios (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nombre TEXT,
      precio INTEGER,
      duracion TEXT
    )
  `);

  // 4. Tabla de excepciones u horarios bloqueados de los barberos
  await db.exec(`
    CREATE TABLE IF NOT EXISTS bloqueos_horarios (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      barbero TEXT,
      fecha TEXT,
      hora TEXT
    )
  `);

  // 5. Tabla de usuarios (Administradores y Barberos)
  await db.exec(`
    CREATE TABLE IF NOT EXISTS usuarios (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT UNIQUE,
      password TEXT,
      nombre TEXT,
      rol TEXT
    )
  `);

  // Insertar un administrador por defecto si no existe (con contraseña hasheada)
  const adminExistente = await db.get('SELECT * FROM usuarios WHERE email = ?', ['admin@monarch.com']);
  if (!adminExistente) {
    const saltRounds = 10;
    const hashedPassword = await bcrypt.hash('admin123', saltRounds);
    await db.run(
      'INSERT INTO usuarios (email, password, nombre, rol) VALUES (?, ?, ?, ?)',
      ['admin@monarch.com', hashedPassword, 'Administrador', 'admin']
    );
    console.log('🛡️ Administrador por defecto creado de forma segura.');
  }

  console.log('✅ Base de datos SQLite conectada correctamente con todas las tablas.');
})();

// ==================== RUTAS DE AUTENTICACIÓN ====================

app.post('/api/login', async (req, res) => {
  const { email, password } = req.body;
  try {
    const usuario = await db.get('SELECT * FROM usuarios WHERE email = ?', [email]);
    
    if (usuario) {
      // Validar la contraseña usando bcrypt.compare
      const passwordValida = await bcrypt.compare(password, usuario.password);
      
      if (passwordValida) {
        res.json({ 
          success: true, 
          usuario: { 
            id: usuario.id, 
            nombre: usuario.nombre, 
            email: usuario.email, 
            rol: usuario.rol 
          } 
        });
        return;
      }
    }
    
    res.status(401).json({ success: false, message: 'Correo o contraseña incorrectos' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==================== RUTAS DE CITAS ====================

app.get('/api/citas', async (req, res) => {
  const citas = await db.all('SELECT * FROM citas');
  res.json(citas);
});

app.get('/api/citas-ocupadas', async (req, res) => {
  const { barbero, fecha } = req.query;
  try {
    const query = `SELECT hora FROM citas WHERE barbero = ? AND fecha = ? AND estado != 'Cancelada'`;
    const rows = await db.all(query, [barbero, fecha]);
    res.json(rows.map(row => row.hora));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/citas', async (req, res) => {
  const { cliente, barbero, servicio, fecha, hora } = req.body;
  const result = await db.run(
    'INSERT INTO citas (cliente, barbero, servicio, fecha, hora) VALUES (?, ?, ?, ?, ?)',
    [cliente, barbero, servicio, fecha, hora]
  );
  res.json({ id: result.lastID, cliente, barbero, servicio, fecha, hora, estado: 'Pendiente' });
});

app.put('/api/citas/:id', async (req, res) => {
  const { id } = req.params;
  const { estado } = req.body;
  await db.run('UPDATE citas SET estado = ? WHERE id = ?', [estado, id]);
  res.json({ message: 'Estado actualizado correctamente' });
});

// ==================== RUTAS DE BARBEROS ====================

app.get('/api/barberos', async (req, res) => {
  try {
    const barberos = await db.all('SELECT * FROM barberos');
    res.json(barberos);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/barberos', async (req, res) => {
  const { nombre, especialidad, experiencia, foto } = req.body;
  try {
    const result = await db.run(
      'INSERT INTO barberos (nombre, especialidad, experiencia, foto) VALUES (?, ?, ?, ?)',
      [nombre, especialidad, experiencia, foto]
    );
    res.json({ id: result.lastID, nombre, especialidad, experiencia, foto });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/barberos/:id', async (req, res) => {
  const { id } = req.params;
  try {
    await db.run('DELETE FROM barberos WHERE id = ?', [id]);
    res.json({ message: 'Barbero eliminado correctamente' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==================== RUTAS DE SERVICIOS ====================

app.get('/api/servicios', async (req, res) => {
  try {
    const servicios = await db.all('SELECT * FROM servicios');
    res.json(servicios);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/servicios', async (req, res) => {
  const { nombre, precio, duracion } = req.body;
  try {
    const result = await db.run(
      'INSERT INTO servicios (nombre, precio, duracion) VALUES (?, ?, ?)',
      [nombre, precio, duracion]
    );
    res.json({ id: result.lastID, nombre, precio, duracion });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==================== RUTAS DE BLOQUEOS / EXCEPCIONES ====================

app.get('/api/bloqueos', async (req, res) => {
  try {
    const bloqueos = await db.all('SELECT * FROM bloqueos_horarios');
    res.json(bloqueos);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/bloqueos', async (req, res) => {
  const { barbero, fecha, hora } = req.body;
  try {
    const result = await db.run(
      'INSERT INTO bloqueos_horarios (barbero, fecha, hora) VALUES (?, ?, ?)',
      [barbero, fecha, hora]
    );
    res.json({ id: result.lastID, barbero, fecha, hora });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/bloqueos/:id', async (req, res) => {
  const { id } = req.params;
  try {
    await db.run('DELETE FROM bloqueos_horarios WHERE id = ?', [id]);
    res.json({ message: 'Bloqueo eliminado correctamente' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==================== SERVIR EL FRONTEND (Carpeta dist) ====================
app.use(express.static(path.join(__dirname, 'dist')));

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

// Arrancar el servidor (Puerto dinámico para producción + respaldo local 3001)
const PORT = process.env.PORT || 3001;

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Servidor y base de datos corriendo en 0.0.0.0:${PORT}`);
});