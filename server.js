const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const path = require('path');
const bcrypt = require('bcrypt');

const app = express();
app.use(cors());

// ✅ Límites aumentados para evitar el error 413 (Payload Too Large) con imágenes en Base64
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));

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
        telefono TEXT,
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
        email TEXT UNIQUE,
        telefono TEXT,
        password TEXT,
        rol TEXT DEFAULT 'barbero',
        especialidad TEXT,
        experiencia TEXT,
        foto TEXT,
        activo BOOLEAN DEFAULT true
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
  const { cliente, telefono, barbero, servicio, fecha, hora, estado } = req.body;
  try {
    const result = await pool.query(
      `INSERT INTO citas (cliente, telefono, barbero, servicio, fecha, hora, estado) 
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      [cliente, telefono, barbero, servicio, fecha, hora, estado || 'Pendiente']
    );
    res.json({ id: result.rows[0].id, cliente, telefono, barbero, servicio, fecha, hora, estado: estado || 'Pendiente' });
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
  const { nombre, email, telefono, password, rol, especialidad, experiencia, foto, activo } = req.body;
  try {
    const result = await pool.query(
      `INSERT INTO barberos (nombre, email, telefono, password, rol, especialidad, experiencia, foto, activo) 
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
      [nombre, email, telefono, password, rol || 'barbero', especialidad, experiencia, foto, activo !== undefined ? activo : true]
    );
    res.json({ id: result.rows[0].id, nombre, email, telefono, rol, especialidad, experiencia, foto, activo });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/barberos/:id', async (req, res) => {
  const { id } = req.params;
  const { nombre, email, telefono, especialidad, experiencia, foto, password, activo } = req.body;
  
  try {
    let query = 'UPDATE barberos SET ';
    const params = [];
    const updates = [];

    if (nombre !== undefined) { updates.push(`nombre = $${params.length + 1}`); params.push(nombre); }
    if (email !== undefined) { updates.push(`email = $${params.length + 1}`); params.push(email); }
    if (telefono !== undefined) { updates.push(`telefono = $${params.length + 1}`); params.push(telefono); }
    if (especialidad !== undefined) { updates.push(`especialidad = $${params.length + 1}`); params.push(especialidad); }
    if (experiencia !== undefined) { updates.push(`experiencia = $${params.length + 1}`); params.push(experiencia); }
    if (foto !== undefined) { updates.push(`foto = $${params.length + 1}`); params.push(foto); }
    if (password !== undefined && password !== '') { updates.push(`password = $${params.length + 1}`); params.push(password); }
    if (activo !== undefined) { updates.push(`activo = $${params.length + 1}`); params.push(activo); }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'No hay datos para actualizar' });
    }

    query += updates.join(', ') + ` WHERE id = $${params.length + 1}`;
    params.push(id);

    const result = await pool.query(query, params);
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Barbero no encontrado' });
    }
    res.json({ id: parseInt(id), ...req.body });
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