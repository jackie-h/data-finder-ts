"""
Generates TypeScript finders for a mapping with a self-referencing association.
Employee has a manager property pointing to another Employee (manager_id → emp_id).

Usage:
    uv run python example/generate_self_ref.py
"""
import os, sys
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'generator', 'src'))

from ts_generator.generator import generate
from model.m3 import Class, Property, String, Integer, Package, Association
from model.mapping import Mapping
from model.relational import Column, Table, Schema, Database
from model.relational_mapping import RelationalPropertyMapping, RelationalClassMapping, Join

repo = Database('hr_db', 'duckdb://test.db')
schema = Schema('hr', repo)

emp_pkg = Package('hr')
employee_c = Class('Employee', [
    Property('Emp Id', 'empId', Integer),
    Property('First Name', 'firstName', String),
    Property('Last Name', 'lastName', String),
    Property('Department', 'department', String),
], emp_pkg)

# Self-referencing property: manager is also an Employee
manager_prop = Property('Manager', 'manager', employee_c)
employee_c.properties['manager'] = manager_prop

# Association: Employee * (employees) ← manager → 1 Employee
# source_property='employees' becomes the reverse method name
# target_property='manager' is the forward property id used as lookup key
Association('EmployeeManager', 'Employee', '*', 'employees', 'Employee', '1', 'manager', emp_pkg)

emp_id = Column('emp_id', 'INT')
first_name = Column('first_name', 'VARCHAR')
last_name = Column('last_name', 'VARCHAR')
department = Column('department', 'VARCHAR')
manager_id = Column('manager_id', 'INT')
employees_t = Table('employees', [emp_id, first_name, last_name, department, manager_id], schema)

pm1 = RelationalPropertyMapping(employee_c.property('empId'), emp_id)
pm2 = RelationalPropertyMapping(employee_c.property('firstName'), first_name)
pm3 = RelationalPropertyMapping(employee_c.property('lastName'), last_name)
pm4 = RelationalPropertyMapping(employee_c.property('department'), department)
pm5 = RelationalPropertyMapping(employee_c.property('manager'), Join(manager_id, emp_id))
rm_e = RelationalClassMapping(employee_c, [pm1, pm2, pm3, pm4, pm5])

mapping = Mapping('Self Ref', [rm_e])

out_dir = os.path.join(os.path.dirname(__file__), '..', 'tests', 'generated_self_ref')
generate(mapping, out_dir)
print('Done.')
