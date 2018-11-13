/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License;
 * you may not use this file except in compliance with the Elastic License.
 */

import { EsClient } from '@code/esqueue';

import { CloneWorkerProgress, Repository, RepositoryUri, WorkerProgress } from '../../model';
import {
  RepositoryDeleteStatusReservedField,
  RepositoryGitStatusReservedField,
  RepositoryIndexNamePrefix,
  RepositoryLspIndexStatusReservedField,
  RepositoryReservedField,
  RepositoryStatusIndexName,
  RepositoryStatusTypeName,
  RepositoryTypeName,
} from '../indexer/schema';

/*
 * This RepositoryObjectClient is dedicated to manipulate resository related objects
 * stored in ES.
 */
export class RepositoryObjectClient {
  constructor(protected readonly esClient: EsClient) {}

  public async getRepositoryGitStatus(repoUri: RepositoryUri): Promise<CloneWorkerProgress> {
    return await this.getRepositoryObject(repoUri, RepositoryGitStatusReservedField);
  }

  public async getRepositoryLspIndexStatus(repoUri: RepositoryUri): Promise<WorkerProgress> {
    return await this.getRepositoryObject(repoUri, RepositoryLspIndexStatusReservedField);
  }

  public async getRepositoryDeleteStatus(repoUri: RepositoryUri): Promise<WorkerProgress> {
    return await this.getRepositoryObject(repoUri, RepositoryDeleteStatusReservedField);
  }

  public async getRepository(repoUri: RepositoryUri): Promise<Repository> {
    return await this.getRepositoryObject(repoUri, RepositoryReservedField);
  }

  public async getAllRepository(): Promise<Repository[]> {
    const res = await this.esClient.search({
      index: `${RepositoryIndexNamePrefix}*`,
      type: RepositoryTypeName,
      body: {
        query: {
          exists: {
            field: RepositoryReservedField,
          },
        },
      },
      from: 0,
      size: 10000,
    });
    const hits: any[] = res.hits.hits;
    const repos: Repository[] = hits.map(hit => {
      const repo: Repository = hit._source[RepositoryReservedField];
      return repo;
    });
    return repos;
  }

  public async setRepositoryGitStatus(repoUri: RepositoryUri, gitStatus: CloneWorkerProgress) {
    return await this.setRepositoryObject(repoUri, RepositoryGitStatusReservedField, gitStatus);
  }

  public async setRepositoryLspIndexStatus(repoUri: RepositoryUri, indexStatus: WorkerProgress) {
    return await this.setRepositoryObject(
      repoUri,
      RepositoryLspIndexStatusReservedField,
      indexStatus
    );
  }

  public async setRepositoryDeleteStatus(repoUri: RepositoryUri, deleteStatus: WorkerProgress) {
    return await this.setRepositoryObject(
      repoUri,
      RepositoryDeleteStatusReservedField,
      deleteStatus
    );
  }

  public async setRepository(repoUri: RepositoryUri, repo: Repository) {
    return await this.setRepositoryObject(repoUri, RepositoryReservedField, repo);
  }

  public async updateRepositoryGitStatus(repoUri: RepositoryUri, obj: any) {
    return await this.updateRepositoryObject(repoUri, RepositoryGitStatusReservedField, obj);
  }

  public async updateRepositoryLspIndexStatus(repoUri: RepositoryUri, obj: any) {
    return await this.updateRepositoryObject(repoUri, RepositoryLspIndexStatusReservedField, obj);
  }

  public async updateRepositoryDeleteStatus(repoUri: RepositoryUri, obj: any) {
    return await this.updateRepositoryObject(repoUri, RepositoryDeleteStatusReservedField, obj);
  }

  public async updateRepository(repoUri: RepositoryUri, obj: any) {
    return await this.updateRepositoryObject(repoUri, RepositoryReservedField, obj);
  }

  public async deleteRepository(repoUri: RepositoryUri) {
    return await this.deleteRepositoryObject(repoUri, RepositoryReservedField);
  }

  private async getRepositoryObject(
    repoUri: RepositoryUri,
    reservedFieldName: string
  ): Promise<any> {
    const res = await this.esClient.get({
      index: RepositoryStatusIndexName(repoUri),
      type: RepositoryStatusTypeName,
      id: this.getRepositoryObjectId(reservedFieldName),
    });
    return res._source[reservedFieldName];
  }

  private async setRepositoryObject(repoUri: RepositoryUri, reservedFieldName: string, obj: any) {
    return await this.esClient.index({
      index: RepositoryStatusIndexName(repoUri),
      type: RepositoryStatusTypeName,
      id: this.getRepositoryObjectId(reservedFieldName),
      body: JSON.stringify({
        [reservedFieldName]: obj,
      }),
    });
  }

  private async updateRepositoryObject(
    repoUri: RepositoryUri,
    reservedFieldName: string,
    obj: any
  ) {
    return await this.esClient.update({
      index: RepositoryStatusIndexName(repoUri),
      type: RepositoryStatusTypeName,
      id: this.getRepositoryObjectId(reservedFieldName),
      body: JSON.stringify({
        doc: {
          [reservedFieldName]: obj,
        },
      }),
    });
  }

  private async deleteRepositoryObject(repoUri: RepositoryUri, reservedFieldName: string) {
    return await this.esClient.delete({
      index: RepositoryStatusIndexName(repoUri),
      type: RepositoryStatusTypeName,
      id: this.getRepositoryObjectId(reservedFieldName),
    });
  }

  private getRepositoryObjectId(reservedFieldName: string): string {
    return reservedFieldName;
  }
}
