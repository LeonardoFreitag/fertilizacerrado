-- Remove os dados de demonstração do manual do usuário (pnpm manual:capture).
-- Alcança SOMENTE o que pertence a usuários do domínio reservado abaixo; não toca em
-- era5_daily_data, estações, calibrações nem em dados de outros usuários.
-- Idempotente: pode rodar várias vezes seguidas.
BEGIN;

CREATE TEMP TABLE _demo_users ON COMMIT DROP AS
  SELECT id FROM users WHERE email LIKE '%@manual.fertilizacerrado.local';

CREATE TEMP TABLE _demo_properties ON COMMIT DROP AS
  SELECT id FROM properties
  WHERE owner_id IN (SELECT id FROM _demo_users) OR agronomist_id IN (SELECT id FROM _demo_users);

-- safras (runs, séries e resumos saem em cascata)
DELETE FROM harvests
WHERE field_id IN (SELECT id FROM fields WHERE property_id IN (SELECT id FROM _demo_properties))
   OR cultivar_id IN (SELECT id FROM cultivars WHERE created_by_id IN (SELECT id FROM _demo_users));


-- propriedades (talhões e era5_cells saem em cascata)
DELETE FROM properties WHERE id IN (SELECT id FROM _demo_properties);

DELETE FROM cultivars WHERE is_default = false AND created_by_id IN (SELECT id FROM _demo_users);

DELETE FROM users WHERE id IN (SELECT id FROM _demo_users);

COMMIT;
