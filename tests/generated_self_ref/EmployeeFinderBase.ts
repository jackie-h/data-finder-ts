import type { Operation } from '@model/relational';
import type { CountAllOperation, NoOperation } from '@model/relational';
import type { Attribute } from '@datafinder/attribute';
import type { FinderResult } from '@datafinder/runner';
import type { IntegerAttribute, StringAttribute } from '@datafinder/typed-attributes';


export abstract class EmployeeRelatedFinderBase {
  abstract empId(): IntegerAttribute;
  abstract firstName(): StringAttribute;
  abstract lastName(): StringAttribute;
  abstract department(): StringAttribute;
  abstract manager(): EmployeeRelatedFinderBase;
  abstract employees(): EmployeeRelatedFinderBase;
}

export abstract class EmployeeFinderBase {
  abstract empId(): IntegerAttribute;
  abstract firstName(): StringAttribute;
  abstract lastName(): StringAttribute;
  abstract department(): StringAttribute;
  abstract manager(): EmployeeRelatedFinderBase;
  abstract employees(): EmployeeRelatedFinderBase;
  abstract count(): CountAllOperation;
  abstract findAll(
    businessDate: Date | string | null,
    processingValidAt: Date | string | null,
    displayColumns: (Attribute | import('@model/relational').RelationalOperationElement)[],
    filterOp?: Operation,
  ): FinderResult;
}