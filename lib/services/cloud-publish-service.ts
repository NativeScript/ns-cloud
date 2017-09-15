import { DEFAULT_ANDROID_PUBLISH_TRACK } from "../constants";
import { basename } from "path";
import * as uuid from "uuid";
import { EOL } from "os";
import { CloudService } from "./cloud-service";

export class CloudPublishService extends CloudService implements ICloudPublishService {
	// Taken from: https://github.com/fastlane/fastlane/blob/master/fastlane_core/lib/fastlane_core/itunes_transporter.rb#L100
	private static ITMS_ERROR_REGEX = /\[Transporter Error Output\]:.*/g;
	// Taken from: https://github.com/fastlane/fastlane/blob/master/spaceship/lib/spaceship/portal/ui/select_team.rb#L88
	private static FASTLANE_MULTIPLE_TEAMS_FOUND_ERROR = "Multiple iTunes Connect Teams found";
	private static GENERAL_ERROR_REGEX = /\[!\].*/g;
	private static IOS_TEAMS_REGEX = /\d+\) "(.*)" \(.*\)/g;

	protected get failedError() {
		return "Publishing failed.";
	}

	protected get failedToStartError() {
		return "Failed to start publishing.";
	}

	constructor($fs: IFileSystem,
		$httpClient: Server.IHttpClient,
		$logger: ILogger,
		private $errors: IErrors,
		private $buildCloudService: IBuildCloudService,
		private $devicePlatformsConstants: Mobile.IDevicePlatformsConstants,
		private $uploadService: IUploadService,
		private $projectDataService: IProjectDataService) {
		super($fs, $httpClient, $logger);
	}

	public getServerOperationOutputDirectory(options: ICloudServerOutputDirectoryOptions): string {
		return "";
	}

	public async publishToItunesConnect(publishData: IItunesConnectPublishData): Promise<void> {
		this.validatePublishData(publishData);

		if (!publishData.credentials || !publishData.credentials.username || !publishData.credentials.password) {
			this.$errors.failWithoutHelp("Cannot perform publish - credentials are required.");
		}

		const appIdentifier = this.$projectDataService.getProjectData(publishData.projectDir).projectId;
		const publishRequestData = {
			appIdentifier,
			credentials: publishData.credentials,
			packagePaths: publishData.packagePaths,
			platform: this.$devicePlatformsConstants.iOS,
			teamId: publishData.teamId
		};

		const getError = (publishResult: IServerResult) => {
			const itmsMessage = this.getFormattedError(publishResult.stdout, CloudPublishService.ITMS_ERROR_REGEX);
			const generalMessage = this.getFormattedError(publishResult.stderr, CloudPublishService.GENERAL_ERROR_REGEX);
			const err: any = new Error(`${publishResult.errors}${EOL}${itmsMessage}${EOL}${generalMessage}`);
			if (_.includes(publishResult.stderr, CloudPublishService.FASTLANE_MULTIPLE_TEAMS_FOUND_ERROR)) {
				const teamNames = [];
				// Fastlane can't decide a team for us and we can't either.
				// Capture the teams and return them to the client.

				// Fastlane's printing logic can be found here https://github.com/fastlane/fastlane/blob/master/spaceship/lib/spaceship/portal/ui/select_team.rb#L86
				// Sample output:
				/*
				Multiple iTunes Connect teams found, please enter the number of the team you want to use:
				Note: to automatically choose the team, provide either the iTunes Connect Team ID, or the Team Name in your fastlane/Appfile:
				Alternatively you can pass the team name or team ID using the `FASTLANE_ITC_TEAM_ID` or `FASTLANE_ITC_TEAM_NAME` environment variable

				itc_team_id "944446"

				or

				itc_team_name "Telerik A D"

				1) "Telerik A D" (944446)
				2) "Telerik AD" (115499815)
				Multiple teams found on iTunes Connect, Your Terminal is running in non-interactive mode! Cannot continue from here.
				Please check that you set FASTLANE_ITC_TEAM_ID or FASTLANE_ITC_TEAM_NAME to the right value.
				*/
				// We need the team names only

				let matches;
				while (matches = CloudPublishService.IOS_TEAMS_REGEX.exec(publishResult.stdout)) {
					teamNames.push(matches[1]);
				}

				err.teamNames = teamNames;
				err.packagePaths = publishRequestData.packagePaths;
			}

			return err;
		};

		return this.publishCore(publishRequestData, publishData, getError);
	}

	public async publishToGooglePlay(publishData: IGooglePlayPublishData): Promise<void> {
		this.validatePublishData(publishData);

		if (!publishData.pathToAuthJson || !this.$fs.exists(publishData.pathToAuthJson)) {
			this.$errors.failWithoutHelp("Cannot perform publish - auth json file is not supplied or missing.");
		}

		let authJson: string;
		try {
			authJson = JSON.stringify(this.$fs.readJson(publishData.pathToAuthJson));
		} catch (ex) {
			this.$errors.failWithoutHelp("Cannot perform publish - auth json file is not in JSON format.");
		}

		publishData.track = publishData.track || DEFAULT_ANDROID_PUBLISH_TRACK;
		const getError = (publishResult: IServerResult) => {
			const generalMessage = this.getFormattedError(publishResult.stderr, CloudPublishService.GENERAL_ERROR_REGEX);
			return new Error(`${publishResult.errors}${EOL}${generalMessage}`);
		};

		const appIdentifier = this.$projectDataService.getProjectData(publishData.projectDir).projectId;
		return this.publishCore({
			appIdentifier,
			credentials: {
				authJson
			},
			packagePaths: publishData.packagePaths,
			platform: this.$devicePlatformsConstants.Android,
			track: publishData.track
		}, publishData, getError);
	}

	private async publishCore(publishRequestData: IPublishRequestData, publishDataCore: IPublishDataCore, getError: (publishResult: IServerResult) => any): Promise<void> {
		publishRequestData.packagePaths = await this.getPreparePackagePaths(publishDataCore);

		this.$logger.info("Starting publishing.");
		const response = await this.$buildCloudService.publish(publishRequestData);

		this.$logger.trace("Publish response", response);
		const buildId = uuid.v4();
		try {
			await this.waitForServerOperationToFinish(buildId, response);
		} catch (ex) {
			this.$logger.trace("Codesign generation failed with err: ", ex);
		}

		const publishResult = await this.getObjectFromS3File<IServerResult>(response.resultUrl);
		this.$logger.trace("Publish result:", publishResult);

		if (publishResult.code || publishResult.errors) {
			const err = getError(publishResult);
			err.stderr = publishResult.stderr;
			err.stdout = publishResult.stdout;
			throw err;
		}

		this.$logger.info("Publishing finished successfully.");
	}

	protected getServerResults(codesignResult: IServerResult): IServerItem[] {
		return [];
	}

	protected async getServerLogs(logsUrl: string, buildId: string): Promise<void> {
		// no specific implementation needed.
	}

	private async getPreparePackagePaths(publishData: IPackagePaths): Promise<string[]> {
		const preparedPackagePaths: string[] = [];
		for (const packagePath of publishData.packagePaths) {
			preparedPackagePaths.push(this.$fs.exists(packagePath) ? await this.$uploadService.uploadToS3(packagePath, basename(packagePath)) : packagePath);
		}

		return preparedPackagePaths;
	}

	private validatePublishData(publishData: IPublishDataCore): void {
		if (!publishData.packagePaths || !publishData.packagePaths.length) {
			this.$errors.failWithoutHelp("Cannot upload without packages");
		}

		if (!publishData.projectDir) {
			this.$errors.failWithoutHelp("Cannot perform publish - projectDir is required.");
		}
	}

	private getFormattedError(message: string, regex: RegExp) {
		return _.uniq(message.match(regex)).join(EOL);
	}
}

$injector.register("cloudPublishService", CloudPublishService);