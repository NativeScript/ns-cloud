import * as path from "path";
import * as uuid from "uuid";
import * as constants from "../constants";
import { CloudService } from "./cloud-service";
import { getProjectId } from "../helpers";

export class CloudCodesignService extends CloudService implements ICloudCodesignService {

	protected get failedError() {
		return "Generation of codesign files failed.";
	}

	protected get failedToStartError() {
		return "Failed to start generation of codesign files.";
	}

	constructor($errors: IErrors,
		$fs: IFileSystem,
		$httpClient: Server.IHttpClient,
		$logger: ILogger,
		$injector: IInjector,
		$nsCloudS3Service: IS3Service,
		$nsCloudOutputFilter: ICloudOutputFilter,
		$processService: IProcessService,
		private $nsCloudServerBuildService: IServerBuildService,
		private $projectHelper: IProjectHelper,
		private $projectDataService: IProjectDataService) {
		super($errors, $fs, $httpClient, $logger, $injector, $nsCloudS3Service, $nsCloudOutputFilter, $processService);
	}

	public async generateCodesignFiles(codesignData: ICodesignData,
		projectDir: string): Promise<ICodesignResultData> {
		this.validateParameteres(codesignData, projectDir);
		codesignData.clean = codesignData.clean === undefined ? true : codesignData.clean;
		const cloudOperationId = uuid.v4();

		try {
			const serverResult = await this.executeGeneration(codesignData, projectDir, cloudOperationId);
			return serverResult;
		} catch (err) {
			err.buildId = cloudOperationId;
			err.cloudOperationId = cloudOperationId;
			throw err;
		}
	}

	protected getServerResults(codesignResult: ICloudOperationResult): IServerItem[] {
		const result = _.filter(codesignResult.buildItems, b => b.disposition === constants.DISPOSITIONS.CERTIFICATE
			|| b.disposition === constants.DISPOSITIONS.PROVISION);

		if (!result) {
			this.$errors.failWithoutHelp(
				`No item with disposition ${constants.DISPOSITIONS.CERTIFICATE} or ${constants.DISPOSITIONS.PROVISION} found in the server result items.`);
		}

		return result;
	}

	public getServerOperationOutputDirectory(options: IOutputDirectoryOptions): string {
		return path.join(options.projectDir, constants.CODESIGN_FILES_DIR_NAME, options.platform.toLowerCase());
	}

	private validateParameteres(codesignData: ICodesignData,
		projectDir: string): void {
		if (!codesignData || !codesignData.username || !codesignData.password) {
			this.$errors.failWithoutHelp(`Codesign failed. Reason is missing code sign data. Apple Id and Apple Id password are required..`);
		}

		if (!projectDir) {
			this.$errors.failWithoutHelp(`Codesign failed. Reason is invalid project path.`);
		}
	}

	private async executeGeneration(codesignData: ICodesignData,
		projectDir: string,
		cloudOperationId: string): Promise<ICodesignResultData> {
		const codesignInformationString = "generation of iOS certificate and provision files";
		this.$logger.info(`Starting ${codesignInformationString}.`);

		const projectData = this.$projectDataService.getProjectData(projectDir);
		const codesignRequest = await this.prepareCodesignRequest(cloudOperationId, codesignData, projectData);
		const codesignResponse: IServerResponse = await this.$nsCloudServerBuildService.generateCodesignFiles(codesignRequest);
		this.$logger.trace(`Codesign response: ${JSON.stringify(codesignResponse)}`);
		let codesignResult;
		try {
			codesignResult = await this.waitForServerOperationToFinish(cloudOperationId, codesignResponse);
		} catch (ex) {
			codesignResult = this.getResult(cloudOperationId);
			if (!codesignResult) {
				throw ex;
			}

			this.$logger.trace("Codesign generation failed with err: ", ex);
		}

		this.$logger.trace("Codesign result:");
		this.$logger.trace(codesignResult);

		if (!codesignResult.buildItems || !codesignResult.buildItems.length) {
			// Something failed.
			let errText = codesignResult.errors || "";
			if (errText.indexOf("403 Forbidden") > -1) {
				this.$logger.trace(`Codesign errors: ${errText}`);
				errText = "The Code Signing Assistance service is temporary unavailable. Please try again later.";
			}

			const err = <IStdError>new Error(`Codesign failed. Reason is: ${errText}.`);
			err.stderr = codesignResult.stderr;
			throw err;
		}

		this.$logger.info(`Finished ${codesignInformationString} successfully. Downloading result...`);

		const localCodesignResults = await this.downloadServerResults(codesignResult, {
			projectDir: projectData.projectDir,
			platform: codesignData.platform,
			emulator: false
		});

		this.$logger.info(`The result of ${codesignInformationString} successfully downloaded. Codesign files paths: ${localCodesignResults}`);

		const result = {
			cloudOperationId: cloudOperationId,
			buildId: cloudOperationId,
			stderr: codesignResult.stderr,
			stdout: codesignResult.stdout,
			outputFilesPaths: localCodesignResults
		};

		return result;
	}

	protected async getServerLogs(logsUrl: string, cloudOperationId: string): Promise<void> {
		// no specific implementation needed.
	}

	private async prepareCodesignRequest(cloudOperationId: string,
		codesignData: ICodesignData,
		projectData: IProjectData): Promise<ICodeSignRequestData> {

		const sanitizedProjectName = this.$projectHelper.sanitizeName(projectData.projectName);
		return {
			cloudOperationId: cloudOperationId,
			appId: getProjectId(projectData, codesignData.platform.toLowerCase()),
			appName: sanitizedProjectName,
			clean: codesignData.clean,
			username: codesignData.username,
			password: codesignData.password,
			sharedCloud: codesignData.sharedCloud,
			devices: codesignData.attachedDevices
		};
	}
}

$injector.register("nsCloudCodesignService", CloudCodesignService);
