# Shop Model

## Sub-Domain: shop

### Class: Customer

| Name     | Description         |
|----------|---------------------|
| Customer | Someone who orders  |

| Property   | Id        | Type    | Multiplicity | Key | Description       |
|------------|-----------|---------|--------------|-----|-------------------|
| Id         | id        | Integer | 1            | Y   |                   |
| Full Name  | fullName  | String  | 1            |     | Name on the order |

### Class: Order

| Name  | Description |
|-------|-------------|
| Order | A purchase  |

| Property | Id    | Type    | Multiplicity | Key | Description |
|----------|-------|---------|--------------|-----|-------------|
| Id       | id    | Integer | 1            | Y   |             |
| Total    | total | Double  | 1            |     | Order total |

### Association: OrderCustomer

| Name          | Source | Source Property Name | Source Property ID | Source Multiplicity | Target   | Target Property Name | Target Property ID | Target Multiplicity | Description |
|---------------|--------|----------------------|--------------------|---------------------|----------|----------------------|--------------------|---------------------|-------------|
| OrderCustomer | Order  | Orders               | orders             | *                   | Customer | Customer             | customer           | 1                   |             |
