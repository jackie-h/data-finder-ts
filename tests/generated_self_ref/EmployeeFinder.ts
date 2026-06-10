import {
  Column, Table, NoOperation, JoinOperation, JoinTreeNodeOperation, CountAllOperation,
  Operation, RelationalOperationElement,
} from '@model/relational';
import {
  ProcessingTemporalColumns, SingleBusinessDateColumn,
  BusinessDateAndProcessingTemporalColumns, BiTemporalColumns, MilestonedTable,
} from '@model/milestoning';
import { convertInputsAndSelect, FinderResult } from '@datafinder/runner';
import type { Attribute } from '@datafinder/attribute';
import { IntegerAttribute, StringAttribute } from '@datafinder/typed-attributes';
import { EmployeeFinderBase, EmployeeRelatedFinderBase } from './EmployeeFinderBase';
import { registerRelatedFinderClass, getRelatedFinderClass } from '@datafinder/finder-registry';


export class EmployeeRelatedFinder extends EmployeeRelatedFinderBase {

  private static readonly _table = new Table('hr.employees', []);

  private readonly _node: JoinTreeNodeOperation;
  private readonly _empId: IntegerAttribute;
  private readonly _firstName: StringAttribute;
  private readonly _lastName: StringAttribute;
  private readonly _department: StringAttribute;
  private _manager?: EmployeeRelatedFinder;
  private _employees?: EmployeeRelatedFinder;

  constructor(relationName: string, source: Column, target: Column, parentJoin?: JoinTreeNodeOperation) {
    super();
    const join = new JoinOperation(relationName, EmployeeRelatedFinder._table, source, target);
    this._node = new JoinTreeNodeOperation(join, parentJoin);
    this._empId = new IntegerAttribute(relationName + ' Emp Id', 'emp_id', 'INT', 'hr.employees', this._node);
    this._firstName = new StringAttribute(relationName + ' First Name', 'first_name', 'VARCHAR', 'hr.employees', this._node);
    this._lastName = new StringAttribute(relationName + ' Last Name', 'last_name', 'VARCHAR', 'hr.employees', this._node);
    this._department = new StringAttribute(relationName + ' Department', 'department', 'VARCHAR', 'hr.employees', this._node);
  }

  empId(): IntegerAttribute {
    return this._empId;
  }

  firstName(): StringAttribute {
    return this._firstName;
  }

  lastName(): StringAttribute {
    return this._lastName;
  }

  department(): StringAttribute {
    return this._department;
  }

  manager(): EmployeeRelatedFinder {
    if (!this._manager) {
      this._manager = new EmployeeRelatedFinder('Manager', new Column('manager_id', 'INT', 'hr.employees'), new Column('emp_id', 'INT', 'hr.employees'), this._node);
    }
    return this._manager!;
  }

  employees(): EmployeeRelatedFinder {
    if (!this._employees) {
      const _Cls = getRelatedFinderClass('Employee') as new (relationName: string, source: Column, target: Column, parentJoin?: JoinTreeNodeOperation) => EmployeeRelatedFinder;
      if (!_Cls) throw new Error('EmployeeRelatedFinder not registered. Import EmployeeFinder before calling employees().');
      this._employees = new _Cls('Employee', new Column('emp_id', 'INT', 'hr.employees'), new Column('manager_id', 'INT', 'hr.employees'), this._node);
    }
    return this._employees!;
  }

}


export class EmployeeFinder extends EmployeeFinderBase {

  private static readonly _table = new Table('hr.employees', []);

  private static readonly _empId = new IntegerAttribute('Emp Id', 'emp_id', 'INT', 'hr.employees');
  private static readonly _firstName = new StringAttribute('First Name', 'first_name', 'VARCHAR', 'hr.employees');
  private static readonly _lastName = new StringAttribute('Last Name', 'last_name', 'VARCHAR', 'hr.employees');
  private static readonly _department = new StringAttribute('Department', 'department', 'VARCHAR', 'hr.employees');
  private _manager?: EmployeeRelatedFinder;
  private _employees?: EmployeeRelatedFinder;

  empId(): IntegerAttribute {
    return EmployeeFinder._empId;
  }

  firstName(): StringAttribute {
    return EmployeeFinder._firstName;
  }

  lastName(): StringAttribute {
    return EmployeeFinder._lastName;
  }

  department(): StringAttribute {
    return EmployeeFinder._department;
  }

  manager(): EmployeeRelatedFinder {
    if (!this._manager) {
      this._manager = new EmployeeRelatedFinder('Manager', new Column('manager_id', 'INT', 'hr.employees'), new Column('emp_id', 'INT', 'hr.employees'));
    }
    return this._manager!;
  }

  employees(): EmployeeRelatedFinder {
    if (!this._employees) {
      const _Cls = getRelatedFinderClass('Employee') as new (relationName: string, source: Column, target: Column, parentJoin?: JoinTreeNodeOperation) => EmployeeRelatedFinder;
      if (!_Cls) throw new Error('EmployeeRelatedFinder not registered. Import EmployeeFinder before calling employees().');
      this._employees = new _Cls('Employee', new Column('emp_id', 'INT', 'hr.employees'), new Column('manager_id', 'INT', 'hr.employees'));
    }
    return this._employees!;
  }

  count(): CountAllOperation {
    return new CountAllOperation('hr.employees');
  }

  findAll(
    businessDate: Date | string | null,
    processingValidAt: Date | string | null,
    displayColumns: (Attribute | RelationalOperationElement)[],
    filterOp: Operation = new NoOperation(),
  ): FinderResult {
    return convertInputsAndSelect(null, null, displayColumns, EmployeeFinder._table, filterOp);
  }
}

registerRelatedFinderClass('Employee', EmployeeRelatedFinder);