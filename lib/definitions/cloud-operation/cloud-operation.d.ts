interface ICloudOperation extends NodeJS.EventEmitter {
	init(): Promise<void>;
	waitForResult(): Promise<ICloudOperationResult>;
	sendMessage<T>(message: ICloudOperationMessage<T>): Promise<void>;
	cleanup(exitCode?: number): Promise<void>;
	getResult(): ICloudOperationResult;
}

interface ICloudOperationWebsocketMessage<T> extends ICloudOperationId {
	id: string;
	action: string;
	body: ICloudOperationMessage<T>;
}

interface ICloudOperationMessage<T> extends ICloudOperationId {
	type: string;
	body?: T;
}

interface ICloudOperationOutput {
	data: string;
	pipe: string;
}

interface ICloudOperationInputBase {
	inputType: string;
	inputRequestId: string;
}

interface ICloudOperationInputRequest extends ICloudOperationInputBase {
	message: string;
}

interface ICloudOperationInput extends ICloudOperationInputBase {
	content: string;
}

interface ICloudOperationStop {
	code?: number;
}

interface ICloudOperationStatus {
	status: string;
}