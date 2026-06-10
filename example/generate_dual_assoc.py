"""
Generates TypeScript finders for a mapping where one class has two associations
to the same target class. Used to reproduce the duplicate-import bug.

Order has both billingAccount and shippingAccount, both of type Account.
"""
import os, sys
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'generator', 'src'))

from ts_generator.generator import generate
from model.m3 import Class, Property, String, Integer, Package
from model.mapping import Mapping
from model.relational import Column, Table, Schema, Database
from model.relational_mapping import RelationalPropertyMapping, RelationalClassMapping, Join

repo = Database('test_db', 'duckdb://test.db')
schema = Schema('shop', repo)

account_c = Class('Account', [
    Property('Id', 'id', Integer),
    Property('Name', 'name', String),
], Package('shop'))

order_c = Class('Order', [
    Property('Id', 'id', Integer),
    Property('Billing Account', 'billingAccount', account_c),
    Property('Shipping Account', 'shippingAccount', account_c),
], Package('shop'))

ac1 = Column('ID', 'INT')
ac2 = Column('NAME', 'VARCHAR')
account_t = Table('account', [ac1, ac2], schema)

oc1 = Column('ID', 'INT')
oc2 = Column('BILLING_ACCOUNT_ID', 'INT')
oc3 = Column('SHIPPING_ACCOUNT_ID', 'INT')
order_t = Table('order_', [oc1, oc2, oc3], schema)

a_pm1 = RelationalPropertyMapping(account_c.property('id'), ac1)
a_pm2 = RelationalPropertyMapping(account_c.property('name'), ac2)
rm_a = RelationalClassMapping(account_c, [a_pm1, a_pm2])

o_pm1 = RelationalPropertyMapping(order_c.property('id'), oc1)
o_pm2 = RelationalPropertyMapping(order_c.property('billingAccount'), Join(oc2, ac1))
o_pm3 = RelationalPropertyMapping(order_c.property('shippingAccount'), Join(oc3, ac1))
rm_o = RelationalClassMapping(order_c, [o_pm1, o_pm2, o_pm3])

mapping = Mapping('Dual Assoc', [rm_a, rm_o])

out_dir = os.path.join(os.path.dirname(__file__), '..', 'tests', 'generated_dual_assoc')
generate(mapping, out_dir)
print('Done.')
