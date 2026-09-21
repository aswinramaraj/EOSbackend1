-- Canteen Admin + Cashier schema — additive only, no existing table touched.
-- Adapted from C:\PRODUCTION\ERP_PROD\craveo\Billing_software\backend\prisma\schema.prisma
-- (the real, running reference app), fitted to EOS conventions:
--   - `canteen_` prefix on every table — EOS already has its OWN generic
--     `expenses`, `expense_categories`, `notifications`, `audit_logs` tables
--     for unrelated purposes; reusing or shadowing those names would either
--     collide or silently mix two different domains' data.
--   - No separate "customer"/user table — every FK that pointed at craveo's
--     own `user_table` now points at EOS's real `users(id)` instead, since
--     canteen_admin/cashier accounts already live there (see
--     scripts/create-canteen-admin-login.ts for the precedent).
-- Scope for this pass (per explicit user direction, 2026-09-16): Admin
-- (dishes/categories/ingredients/recipes/expenses/reports) + the
-- orders/bills tables Cashier will write to next phase — no wallets, no
-- "counters", no hosteller/parcel/COD tracking, no print/kiosk hardware
-- integration, no razorpay/online-payment tables. Those all depend on the
-- future student-ordering phase and were explicitly deferred.

CREATE TABLE canteen_dish_categories (
  id         SERIAL PRIMARY KEY,
  name       VARCHAR(100) NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE canteen_dishes (
  id          SERIAL PRIMARY KEY,
  name        VARCHAR(150) NOT NULL,
  category_id INTEGER REFERENCES canteen_dish_categories(id) ON DELETE SET NULL,
  price       DECIMAL(10,2) NOT NULL,
  stock_quantity INTEGER NOT NULL DEFAULT 0,
  image_url   TEXT,
  is_veg      BOOLEAN NOT NULL DEFAULT true,
  is_available BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_canteen_dishes_category ON canteen_dishes(category_id);
CREATE INDEX idx_canteen_dishes_stock_lookup ON canteen_dishes(id, stock_quantity, price);

CREATE TABLE canteen_ingredients (
  id             SERIAL PRIMARY KEY,
  name           VARCHAR(150) NOT NULL UNIQUE,
  stock_quantity DECIMAL(10,2) NOT NULL DEFAULT 0,
  price_per_unit DECIMAL(10,2) NOT NULL,
  threshold      DECIMAL(10,2) NOT NULL DEFAULT 0,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE canteen_recipes (
  id         SERIAL PRIMARY KEY,
  dish_id    INTEGER NOT NULL UNIQUE REFERENCES canteen_dishes(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE canteen_recipe_ingredients (
  id              SERIAL PRIMARY KEY,
  recipe_id       INTEGER NOT NULL REFERENCES canteen_recipes(id) ON DELETE CASCADE,
  ingredient_id   INTEGER NOT NULL REFERENCES canteen_ingredients(id) ON DELETE RESTRICT,
  quantity_needed DECIMAL(10,2) NOT NULL,
  unit            VARCHAR(20) NOT NULL,
  UNIQUE (recipe_id, ingredient_id)
);

CREATE TABLE canteen_expense_categories (
  id   SERIAL PRIMARY KEY,
  name VARCHAR(100) NOT NULL UNIQUE
);

CREATE TABLE canteen_expenses (
  id           SERIAL PRIMARY KEY,
  name         VARCHAR(150) NOT NULL,
  category_id  INTEGER REFERENCES canteen_expense_categories(id) ON DELETE SET NULL,
  vendor_name  VARCHAR(150),
  quantity     DECIMAL(10,2) NOT NULL,
  date         TIMESTAMPTZ NOT NULL DEFAULT now(),
  total_amount DECIMAL(10,2) NOT NULL,
  recorded_by_user_id INTEGER REFERENCES public.users(id) ON DELETE SET NULL
);
CREATE INDEX idx_canteen_expenses_category_date ON canteen_expenses(category_id, date);

CREATE TABLE canteen_expense_products (
  id             SERIAL PRIMARY KEY,
  category_id    INTEGER REFERENCES canteen_expense_categories(id) ON DELETE SET NULL,
  product_name   VARCHAR(150) NOT NULL,
  price_per_unit DECIMAL(10,2) NOT NULL
);

CREATE TABLE canteen_stock_batches (
  id                 SERIAL PRIMARY KEY,
  product_id         INTEGER NOT NULL REFERENCES canteen_expense_products(id) ON DELETE CASCADE,
  quantity           INTEGER NOT NULL,
  remaining_quantity INTEGER NOT NULL,
  unit_price         DECIMAL(10,2) NOT NULL,
  date_added         TIMESTAMPTZ NOT NULL DEFAULT now(),
  supplier           VARCHAR(150),
  batch_reference    VARCHAR(100),
  notes              TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_canteen_stock_batches_product_date ON canteen_stock_batches(product_id, date_added);

CREATE TABLE canteen_stock_transactions (
  id               SERIAL PRIMARY KEY,
  product_id       INTEGER NOT NULL REFERENCES canteen_expense_products(id) ON DELETE CASCADE,
  transaction_type VARCHAR(20) NOT NULL,
  quantity         INTEGER NOT NULL,
  unit_price       DECIMAL(10,2),
  total_cost       DECIMAL(10,2),
  batch_id         INTEGER REFERENCES canteen_stock_batches(id) ON DELETE SET NULL,
  reference_id     VARCHAR(100),
  reference_type   VARCHAR(50),
  transaction_date TIMESTAMPTZ NOT NULL DEFAULT now(),
  notes            TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_canteen_stock_transactions_product ON canteen_stock_transactions(product_id);
CREATE INDEX idx_canteen_stock_transactions_batch ON canteen_stock_transactions(batch_id);
CREATE INDEX idx_canteen_stock_transactions_reference ON canteen_stock_transactions(reference_id, reference_type);

-- order_source is deliberately kept (not dropped) even though only 'cashier'
-- is possible in this phase — it's the one field the future student-app
-- phase needs to distinguish who placed an order, and adding it later would
-- mean backfilling every existing row. Everything COD/parcel/hosteller-
-- specific from craveo's own order_table was left out, since those are real
-- only once student ordering exists.
CREATE TABLE canteen_orders (
  id               SERIAL PRIMARY KEY,
  placed_by_user_id INTEGER REFERENCES public.users(id) ON DELETE SET NULL,
  status           VARCHAR(20) NOT NULL DEFAULT 'pending',
  payment_method   VARCHAR(50),
  total_amount     DECIMAL(10,2),
  order_source     VARCHAR(20) NOT NULL DEFAULT 'cashier',
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_canteen_orders_status ON canteen_orders(status);
CREATE INDEX idx_canteen_orders_source_created ON canteen_orders(order_source, created_at DESC);

CREATE TABLE canteen_order_items (
  id          SERIAL PRIMARY KEY,
  order_id    INTEGER NOT NULL REFERENCES canteen_orders(id) ON DELETE CASCADE,
  dish_id     INTEGER REFERENCES canteen_dishes(id) ON DELETE SET NULL,
  category_id INTEGER REFERENCES canteen_dish_categories(id) ON DELETE SET NULL,
  quantity    INTEGER NOT NULL,
  price       DECIMAL(10,2) NOT NULL
);
CREATE INDEX idx_canteen_order_items_order_dish ON canteen_order_items(order_id, dish_id);

CREATE TABLE canteen_bills (
  id               SERIAL PRIMARY KEY,
  order_id         INTEGER REFERENCES canteen_orders(id) ON DELETE SET NULL,
  cashier_user_id  INTEGER REFERENCES public.users(id) ON DELETE SET NULL,
  mode_of_payment  VARCHAR(20) NOT NULL,
  bill_amount      DECIMAL(10,2) NOT NULL,
  date_time        TIMESTAMPTZ NOT NULL DEFAULT now(),
  bill_type        VARCHAR(50),
  transaction_status BOOLEAN NOT NULL DEFAULT true
);
CREATE INDEX idx_canteen_bills_date ON canteen_bills(date_time);
CREATE INDEX idx_canteen_bills_cashier ON canteen_bills(cashier_user_id);

CREATE TABLE canteen_gst_rates (
  id             SERIAL PRIMARY KEY,
  category_id    INTEGER REFERENCES canteen_dish_categories(id) ON DELETE CASCADE,
  gst_percentage DECIMAL(5,2) NOT NULL
);

CREATE TABLE canteen_todays_specials (
  id             SERIAL PRIMARY KEY,
  meal_type      VARCHAR(10) NOT NULL,
  image_url      TEXT NOT NULL,
  display_order  INTEGER NOT NULL DEFAULT 0,
  special_date   DATE NOT NULL DEFAULT CURRENT_DATE,
  is_active      BOOLEAN NOT NULL DEFAULT true,
  created_by_user_id INTEGER REFERENCES public.users(id) ON DELETE SET NULL,
  UNIQUE (meal_type, display_order, special_date)
);
CREATE INDEX idx_canteen_todays_specials_active ON canteen_todays_specials(is_active);
CREATE INDEX idx_canteen_todays_specials_date ON canteen_todays_specials(special_date);
CREATE INDEX idx_canteen_todays_specials_meal ON canteen_todays_specials(meal_type);
