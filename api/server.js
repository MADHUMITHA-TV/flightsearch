const express = require('express');

const searchRoutes = require('./routes/search');
const filterRoutes = require('./routes/filter');
const flightRoutes = require('./routes/flight');

const app = express();
app.use(express.json());

app.get('/health', (req, res) => res.json({ status: 'ok' }));

app.use('/', searchRoutes);
app.use('/', filterRoutes);
app.use('/', flightRoutes);

// Central error handler
app.use((err, req, res, next) => {
  console.error(err);
  res.status(err.status || 500).json({ error: err.message || 'Internal server error' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`FlightSearch API listening on port ${PORT}`);
  console.log(`  GET /search?origin=SIN&destination=JFK&startDate=2026-10-01&endDate=2026-10-07`);
  console.log(`  GET /filter?origin=SIN&destination=JFK&seatClass=ECONOMY&maxPrice=400`);
  console.log(`  GET /flight/:flightId`);
});

module.exports = app;
