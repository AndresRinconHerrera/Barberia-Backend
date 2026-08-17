const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const path = require('path');
const bcrypt = require('bcrypt');

const app = express();
app.use(cors());
app.use(express.json());

// Extraer los parámetros de la URL para forzar una conexión IPv4 limpia en Render
const connectionString = process.env.DATABASE_URL;
const url = new URL(connectionString);

const pool = new Pool({
  host: url.hostname,
  port: url.port || 5432,
  database: url.pathname.slice(1),
  user: url.username,
  password: url.password,
  ssl: {
    rejectUnauthorized: false
  }
});

// Inicializar tablas en PostgreSQL al arrancar
async function inicializarTablas() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS citas (
        id SERIAL PRIMARY KEY,
        cliente TEXT,
        barbero TEXT,
        servicio TEXT,
        fecha TEXT,
        hora TEXT,
        estado TEXT DEFAULT 'Pendiente'
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS barberos (
        id SERIAL PRIMARY KEY,
        nombre TEXT,
        especialidad TEXT,
        experiencia TEXT,
        foto TEXT
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS servicios (
        id SERIAL PRIMARY KEY,
        nombre TEXT,
        precio INTEGER,
        duracion TEXT
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS bloqueos_horarios (
        id SERIAL PRIMARY KEY,
        barbero TEXT,
        fecha TEXT,
        hora TEXT
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS usuarios (
        id SERIAL PRIMARY KEY,
        email TEXT UNIQUE,
        password TEXT,
        nombre TEXT,
        rol TEXT
      )
    `);

    // Crear usuario admin por defecto si no existe
    const adminCheck = await pool.query('SELECT * FROM usuarios WHERE email = $1', ['admin@monarch.com']);
    if (adminCheck.rows.length === 0) {
      const hashedPassword = await bcrypt.hash('admin123', 10);
      await pool.query(
        'INSERT INTO usuarios (email, password, nombre, rol) VALUES ($1, $2, $3, $4)',
        ['admin@monarch.com', hashedPassword, 'Administrador', 'admin']
      );
      console.log('🛡️ Administrador por defecto creado.');
    }

    console.log('✅ Base de datos PostgreSQL conectada y tablas listas.');
  } catch (err) {
    console.error('❌ Error al inicializar tablas:', err);
  }
}

// ==================== RUTAS ====================

app.post('/api/login', async (req, res) => {
  const { email, password } = req.body;
  try {
    const result = await pool.query('SELECT * FROM usuarios WHERE email = $1', [email]);
    const usuario = result.rows[0];
    if (usuario && await bcrypt.compare(password, usuario.password)) {
      return res.json({ 
        success: true, 
        usuario: { id: usuario.id, nombre: usuario.nombre, email: usuario.email, rol: usuario.rol } 
      });
    }
    res.status(401).json({ success: false, message: 'Correo o contraseña incorrectos' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/citas', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM citas');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/citas-ocupadas', async (req, res) => {
  const { barbero, fecha } = req.query;
  try {
    const result = await pool.query(
      `SELECT hora FROM citas WHERE barbero = $1 AND fecha = $2 AND estado != 'Cancelada'`, 
      [barbero, fecha]
    );
    res.json(result.rows.map(row => row.hora));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/citas', async (req, res) => {
  const { cliente, barbero, servicio, fecha, hora } = req.body;
  try {
    const result = await pool.query(
      'INSERT INTO citas (cliente, barbero, servicio, fecha, hora) VALUES ($1, $2, $3, $4, $5) RETURNING id',
      [cliente, barbero, servicio, fecha, hora]
    );
    res.json({ id: result.rows[0].id, cliente, barbero, servicio, fecha, hora, estado: 'Pendiente' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/citas/:id', async (req, res) => {
  const { id } = req.params;
  const { estado } = req.body;
  try {
    await pool.query('UPDATE citas SET estado = $1 WHERE id = $2', [estado, id]);
    res.json({ message: 'Estado actualizado correctamente' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/barberos', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM barberos');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/barberos', async (req, res) => {
  const { nombre, especialidad, experiencia, foto } = req.body;
  try {
    const result = await pool.query(
      'INSERT INTO barberos (nombre, especialidad, experiencia, foto) VALUES ($1, $2, $3, $4) RETURNING id',
      [nombre, especialidad, experiencia, foto]
    );
    res.json({ id: result.rows[0].id, nombre, especialidad, experiencia, foto });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/barberos/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM barberos WHERE id = $1', [req.params.id]);
    res.json({ message: 'Barbero eliminado correctamente' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/servicios', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM servicios');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/servicios', async (req, res) => {
  const { nombre, precio, duracion } = req.body;
  try {
    const result = await pool.query(
      'INSERT INTO servicios (nombre, precio, duracion) VALUES ($1, $2, $3) RETURNING id',
      [nombre, precio, duracion]
    );
    res.json({ id: result.rows[0].id, nombre, precio, duracion });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/bloqueos', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM bloqueos_horarios');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/bloqueos', async (req, res) => {
  const { barbero, fecha, hora } = req.body;
  try {
    const result = await pool.query(
      'INSERT INTO bloqueos_horarios (barbero, fecha, hora) VALUES ($1, $2, $3) RETURNING id',
      [barbero, fecha, hora]
    );
    res.json({ id: result.rows[0].id, barbero, fecha, hora });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/bloqueos/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM bloqueos_horarios WHERE id = $1', [req.params.id]);
    res.json({ message: 'Bloqueo eliminado correctamente' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.use(express.static(path.join(__dirname, 'dist')));
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});
 
// Inicializar y arrancar servidor
inicializarTablas().then(() => {
  const PORT = process.env.PORT || 3001;
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Servidor corriendo en el puerto ${PORT}`);
  });
});