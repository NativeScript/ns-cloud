/**
 * Defines the result of the project cleanup method.
 */
interface ICleanupProjectResult {
	cleanupTaskResults: ICleanupTaskResult[];
}

/**
 * Defines the properties of single cleanup task.
 */
interface ICleanupTaskResult {
	cloudOperationId: string;
	cloudTasksResults: IDictionary<IServerResult>;
	codeCommitResponse: IDeleteRepositoryResponse;
	warnings: Error[];
}

/**
 * Defines operations for managing cloud projects.
 */
interface ICloudProjectService extends ICloudOperationService {
	/**
	 * Cleans all AWS CodeCommit data and build machines artefacts if they exist.
	 * @param {ICleanupRequestDataBase} cleanupProjectData Data needed for project cleaning.
	 * @returns {Promise<ICleanupProjectResult>} Information about the cleanup. It includes AWS CodeCommit result and the result from the cleanup on each build machine.
	 * If the promise is rejected the error will contain cloudOperationId property.
	 */
	cleanupProject(cleanupProjectData: ICleanupRequestDataBase): Promise<ICleanupProjectResult>;
}
