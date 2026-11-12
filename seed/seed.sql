-- QuickDish sample data: 4 categories, 12 products and 2 test users.
-- Safe to run more than once: existing rows (same id) are left as they are.
--
-- Local: pnpm db:seed:local
-- Dev:   wrangler d1 execute DB --env dev --remote --file seed/seed.sql

INSERT OR IGNORE INTO "categories" ("id", "name", "description", "active") VALUES
  ('8b1f4c2e-0001-4a6b-9c1d-000000000001', 'Tacos', 'Tacos al estilo de la casa', 1),
  ('8b1f4c2e-0001-4a6b-9c1d-000000000002', 'Bowls', 'Bowls y ensaladas', 1),
  ('8b1f4c2e-0001-4a6b-9c1d-000000000003', 'Bebidas', 'Aguas frescas, refrescos y café', 1),
  ('8b1f4c2e-0001-4a6b-9c1d-000000000004', 'Postres', 'Algo dulce para terminar', 1);

INSERT OR IGNORE INTO "products" ("id", "name", "description", "priceCents", "imageUrl", "available", "categoryId") VALUES
  ('3c9e7a10-0002-4f2b-8e5a-000000000001', 'Taco al pastor', 'Cerdo al pastor con piña, cebolla y cilantro', 3500, 'https://placehold.co/600x400?text=Taco+al+pastor', 1, '8b1f4c2e-0001-4a6b-9c1d-000000000001'),
  ('3c9e7a10-0002-4f2b-8e5a-000000000002', 'Taco de asada', 'Arrachera a la parrilla con guacamole', 4200, 'https://placehold.co/600x400?text=Taco+de+asada', 1, '8b1f4c2e-0001-4a6b-9c1d-000000000001'),
  ('3c9e7a10-0002-4f2b-8e5a-000000000003', 'Taco de coliflor', 'Coliflor rostizada con salsa de chile morita', 3200, 'https://placehold.co/600x400?text=Taco+de+coliflor', 1, '8b1f4c2e-0001-4a6b-9c1d-000000000001'),
  ('3c9e7a10-0002-4f2b-8e5a-000000000004', 'Bowl de pollo', 'Arroz, frijoles, pollo, pico de gallo y aguacate', 12900, 'https://placehold.co/600x400?text=Bowl+de+pollo', 1, '8b1f4c2e-0001-4a6b-9c1d-000000000002'),
  ('3c9e7a10-0002-4f2b-8e5a-000000000005', 'Bowl vegetariano', 'Quinoa, verduras asadas y aderezo de cilantro', 11900, 'https://placehold.co/600x400?text=Bowl+vegetariano', 1, '8b1f4c2e-0001-4a6b-9c1d-000000000002'),
  ('3c9e7a10-0002-4f2b-8e5a-000000000006', 'Ensalada César', 'Lechuga romana, crutones, parmesano y pollo', 10900, 'https://placehold.co/600x400?text=Ensalada+Cesar', 0, '8b1f4c2e-0001-4a6b-9c1d-000000000002'),
  ('3c9e7a10-0002-4f2b-8e5a-000000000007', 'Agua de horchata', 'Vaso de 500 ml', 3500, 'https://placehold.co/600x400?text=Horchata', 1, '8b1f4c2e-0001-4a6b-9c1d-000000000003'),
  ('3c9e7a10-0002-4f2b-8e5a-000000000008', 'Agua de jamaica', 'Vaso de 500 ml', 3500, 'https://placehold.co/600x400?text=Jamaica', 1, '8b1f4c2e-0001-4a6b-9c1d-000000000003'),
  ('3c9e7a10-0002-4f2b-8e5a-000000000009', 'Café americano', 'Taza de 350 ml', 4000, 'https://placehold.co/600x400?text=Cafe', 1, '8b1f4c2e-0001-4a6b-9c1d-000000000003'),
  ('3c9e7a10-0002-4f2b-8e5a-000000000010', 'Churros', 'Tres churros con cajeta', 5500, 'https://placehold.co/600x400?text=Churros', 1, '8b1f4c2e-0001-4a6b-9c1d-000000000004'),
  ('3c9e7a10-0002-4f2b-8e5a-000000000011', 'Flan napolitano', 'Rebanada con caramelo', 4900, 'https://placehold.co/600x400?text=Flan', 1, '8b1f4c2e-0001-4a6b-9c1d-000000000004'),
  ('3c9e7a10-0002-4f2b-8e5a-000000000012', 'Pastel de tres leches', 'Rebanada individual', 6500, 'https://placehold.co/600x400?text=Tres+leches', 1, '8b1f4c2e-0001-4a6b-9c1d-000000000004');

-- Test users for local and Dev only. Never seed them in Prod.
--   admin@quickdish.test    / Admin12345     (ADMIN)
--   customer@quickdish.test / Customer12345  (CUSTOMER)
INSERT OR IGNORE INTO "users" ("id", "name", "email", "passwordHash", "role") VALUES
  ('5d2a9e41-0003-4c7d-9b2f-000000000001', 'Admin QuickDish', 'admin@quickdish.test', 'pbkdf2$10000$n0zMd3OT7UkizjgzXWoBuA==$SUabqLGCdhqo23uLZSJ8c7mjqZozwJFMbSOuKSY0hng=', 'ADMIN'),
  ('5d2a9e41-0003-4c7d-9b2f-000000000002', 'Cliente de Prueba', 'customer@quickdish.test', 'pbkdf2$10000$NjYF2bXsDygCc9e7gZlY7w==$5G5UIYliSZGYuIF+9XklPCqbAOolmmdGCrUfBBCggfw=', 'CUSTOMER');
