export interface ObservedResult<T> {
  readonly value: T | null;
  readonly error: Error | null;
  readonly isFetching: boolean;
}

export type ObservedResultListener<T> = (result: ObservedResult<T>) => void;

export interface ObservedPaginatedResult<T> extends ObservedResult<T> {
  readonly hasMore: boolean;
  readonly isFetchingNextPage: boolean;
}

export type ObservedPaginatedResultListener<T> = (result: ObservedPaginatedResult<T>) => void;
