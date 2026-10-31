# Shop Mapping

## Model: shop_model.md

## DataStore: shop_db (Database)

### Schema: sales

#### Table: customers → Customer

| Column    | Type    | Key | Nullable | Property ID |
|-----------|---------|-----|----------|-------------|
| id        | INT     | PK  | N        | id          |
| full_name | VARCHAR |     | Y        | fullName    |

#### Table: orders → Order

| Column      | Type   | Key | Nullable | Property ID |
|-------------|--------|-----|----------|-------------|
| id          | INT    | PK  | N        | id          |
| total       | DOUBLE |     | Y        | total       |
| customer_id | INT    | FK  | Y        | customer    |

#### Association: OrderCustomer

| Source Column | Target Table | Target Column |
|---------------|--------------|---------------|
| customer_id   | customers    | id            |
