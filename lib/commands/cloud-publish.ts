import { DEFAULT_ANDROID_PUBLISH_TRACK, ERROR_MESSAGES } from "../constants";
import { isInteractive } from "../helpers";
import { InteractiveCloudCommand } from "./interactive-cloud-command";

abstract class CloudPublish extends InteractiveCloudCommand {
	public allowedParameters: ICommandParameter[];
	public get dashedOptions() {
		return this.$nsCloudOptionsProvider.dashedOptions;
	}

	constructor($nsCloudProcessService: IProcessService,
		private $nsCloudOptionsProvider: ICloudOptionsProvider,
		protected $nsCloudErrorsService: IErrors,
		protected $logger: ILogger,
		protected $prompter: IPrompter,
		protected $projectData: IProjectData,
		protected $options: ICloudOptions,
		protected $devicePlatformsConstants: Mobile.IDevicePlatformsConstants,
		protected $nsCloudAndroidBundleValidatorHelper: IAndroidBundleValidatorHelper,
		protected $nsCloudPublishService: ICloudPublishService) {
		super($nsCloudPublishService, $nsCloudProcessService, $nsCloudErrorsService, $logger, $prompter);
		this.$projectData.initializeProjectData();
	}

	public async canExecute(args: string[]): Promise<boolean> {
		(<INSCloudGlobal>global).showErrorForStoppedCloudBuilds();
		this.$nsCloudAndroidBundleValidatorHelper.validateNoAab();

		return true;
	}
}

export class CloudPublishAndroid extends CloudPublish implements ICommand {
	constructor($nsCloudOptionsProvider: ICloudOptionsProvider,
		$logger: ILogger,
		$nsCloudProcessService: IProcessService,
		private $nsCloudBuildCommandHelper: IBuildCommandHelper,
		private $nsCloudEulaCommandHelper: IEulaCommandHelper,
		protected $nsCloudErrorsService: IErrors,
		protected $nsCloudPublishService: ICloudPublishService,
		protected $prompter: IPrompter,
		protected $projectData: IProjectData,
		protected $options: ICloudOptions,
		protected $devicePlatformsConstants: Mobile.IDevicePlatformsConstants,
		protected $nsCloudAndroidBundleValidatorHelper: IAndroidBundleValidatorHelper
	) {
		super($nsCloudProcessService, $nsCloudOptionsProvider, $nsCloudErrorsService, $logger, $prompter, $projectData, $options, $devicePlatformsConstants, $nsCloudAndroidBundleValidatorHelper, $nsCloudPublishService);
	}

	public async canExecute(args: string[]): Promise<boolean> {
		await this.$nsCloudEulaCommandHelper.ensureEulaIsAccepted();

		await super.canExecute(args);

		if (args.length > 1 || (!isInteractive() && args.length < 1)) {
			this.$nsCloudErrorsService.failWithHelp("The command accepts only one parameter - Path to authentication JSON");
		}

		return true;
	}

	protected async executeCore(args: string[]): Promise<void> {
		let pathToAuthJson = args[0];
		let track = this.$options.track;

		if (!pathToAuthJson) {
			pathToAuthJson = await this.$prompter.getString("Path to auth JSON", { allowEmpty: false });
		}

		if (!track) {
			track = await this.$prompter.getString("Track", { defaultAction: () => DEFAULT_ANDROID_PUBLISH_TRACK });
		}

		const packagePath = await this.$nsCloudBuildCommandHelper.buildForPublishingPlatform(this.$devicePlatformsConstants.Android);

		return this.$nsCloudPublishService.publishToGooglePlay({
			track,
			pathToAuthJson,
			packagePaths: [packagePath],
			sharedCloud: this.$options.sharedCloud,
			projectDir: this.$projectData.projectDir,
			androidReleaseStatus: this.$options.androidReleaseStatus
		});
	}
}

$injector.registerCommand("cloud|publish|android", CloudPublishAndroid);

export class CloudPublishIos extends CloudPublish implements ICommand {
	constructor($nsCloudOptionsProvider: ICloudOptionsProvider,
		$logger: ILogger,
		$nsCloudProcessService: IProcessService,
		private $nsCloudBuildCommandHelper: IBuildCommandHelper,
		private $nsCloudEulaCommandHelper: IEulaCommandHelper,
		protected $nsCloudErrorsService: IErrors,
		protected $nsCloudPublishService: ICloudPublishService,
		protected $prompter: IPrompter,
		protected $projectData: IProjectData,
		protected $options: ICloudOptions,
		protected $devicePlatformsConstants: Mobile.IDevicePlatformsConstants,
		$nsCloudAndroidBundleValidatorHelper: IAndroidBundleValidatorHelper) {
		super($nsCloudProcessService, $nsCloudOptionsProvider, $nsCloudErrorsService, $logger, $prompter, $projectData, $options, $devicePlatformsConstants, $nsCloudAndroidBundleValidatorHelper, $nsCloudPublishService);
	}

	public async canExecute(args: string[]): Promise<boolean> {
		await this.$nsCloudEulaCommandHelper.ensureEulaIsAccepted();

		await super.canExecute(args);

		if (args.length > 2 || (!isInteractive() && args.length < 1)) {
			this.$nsCloudErrorsService.failWithHelp(ERROR_MESSAGES.COMMAND_REQUIRES_APPLE_USERNAME_PASS);
		}

		return true;
	}

	protected async executeCore(args: string[]): Promise<void> {
		const credentials: IPublishCredentials = await this.$nsCloudBuildCommandHelper.getExtendedAppleCredentials(args, this.$options);
		const packagePath = await this.$nsCloudBuildCommandHelper.buildForPublishingPlatform(this.$devicePlatformsConstants.iOS);
		const itunesPublishData: IItunesConnectPublishData = {
			credentials,
			packagePaths: [packagePath],
			sharedCloud: this.$options.sharedCloud,
			projectDir: this.$projectData.projectDir
		};

		await this.$nsCloudPublishService.publishToItunesConnect(itunesPublishData);
	}
}

$injector.registerCommand("cloud|publish|ios", CloudPublishIos);
