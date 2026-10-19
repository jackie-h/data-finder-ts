/** The GraphQL argument names an endpoint uses for server-side push-down of filters, sorts and limits. */
export class GraphQLFilterConvention {
  constructor(
    readonly filterArg: string,  // e.g. "where", "filter"
    readonly sortArg: string,    // e.g. "order_by", "orderBy"
    readonly limitArg: string,   // e.g. "limit", "take", "first"
  ) {}
}

export class GraphQLEndpoint {
  constructor(
    readonly url: string,
    readonly filterConvention?: GraphQLFilterConvention,
  ) {}
}

export class GraphQLProcessingMilestone {
  constructor(readonly argumentName: string = 'asOf') {}
}

export class GraphQLBusinessDateMilestone {
  constructor(readonly argumentName: string = 'businessDate') {}
}

export class GraphQLBiTemporalMilestone {
  constructor(
    readonly businessDateArgument: string = 'businessDate',
    readonly processingArgument: string = 'asOf',
  ) {}
}

export type GraphQLMilestone =
  | GraphQLProcessingMilestone
  | GraphQLBusinessDateMilestone
  | GraphQLBiTemporalMilestone;

export class GraphQLQuery {
  constructor(
    readonly name: string,
    readonly endpoint: GraphQLEndpoint,
    readonly milestone?: GraphQLMilestone,
  ) {}
}

export class GraphQLField {
  constructor(readonly name: string) {}
}
