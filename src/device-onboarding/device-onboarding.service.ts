import {
  Injectable,
  NotFoundException,
  ConflictException,
  Logger,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import * as PDFDocument from 'pdfkit';
import * as ExcelJS from 'exceljs';
import { format } from '@fast-csv/format';
import { Response } from 'express';
import axios from 'axios';
import {
  DeviceOnboarding,
  DeviceOnboardingDocument,
} from './schema/device-onboarding.schema';
import { CreateDeviceOnboardingDto } from './dto/create-device-onboarding.dto';
import { DeviceOnboardingQueryDto } from './dto/device-onboaring-query.dto';
import { PaginatedResponse } from 'src/comman/pagination.dto';
import { UpdateDeviceOnboardingDto } from './dto/update-device-onboarding.dto';

@Injectable()
export class DeviceOnboardingService {
  private readonly logger = new Logger(DeviceOnboardingService.name);
  private readonly logsServiceUrl =
    process.env.LOGS_SERVICE_URL || 'http://localhost:3001/logs';

  constructor(
    @InjectModel(DeviceOnboarding.name)
    private deviceModel: Model<DeviceOnboardingDocument>,
  ) {}

  private async sendLog(logData: {
    method: string;
    url: string;
    statusCode: number;
    operation: string;
    resource: string;
    message: string;
    userId?: string;
    metadata?: any;
    responseTime?: number;
    isError?: boolean;
    errorMessage?: string;
    stackTrace?: string;
  }): Promise<void> {
    try {
      await axios.post(
        this.logsServiceUrl,
        {
          ...logData,
          timestamp: new Date(),
          ipAddress: 'internal',
          userAgent: 'device-service',
        },
        {
          timeout: 5000, // 5 second timeout
          headers: {
            'Content-Type': 'application/json',
          },
        },
      );
    } catch (error) {
      // Silent fail - don't let logging break main functionality
      this.logger.warn(`Failed to send log to microservice: ${error.message}`);
    }
  }

  async create(
    createDeviceDto: CreateDeviceOnboardingDto,
    userId?: string,
  ): Promise<DeviceOnboarding> {
    const startTime = Date.now();

    try {
      // Check for duplicate IMEI or Serial Number
      const existingDevice = await this.deviceModel.findOne({
        $or: [
          { deviceIMEI: createDeviceDto.deviceIMEI },
          { deviceSerialNo: createDeviceDto.deviceSerialNo },
        ],
      });

      if (existingDevice) {
        await this.sendLog({
          method: 'POST',
          url: '/device-onboarding',
          statusCode: 409,
          operation: 'CREATE_DEVICE',
          resource: 'device-onboarding',
          message: 'Device creation failed - duplicate IMEI or Serial Number',
          userId,
          metadata: {
            deviceIMEI: createDeviceDto.deviceIMEI,
            deviceSerialNo: createDeviceDto.deviceSerialNo,
          },
          responseTime: Date.now() - startTime,
          isError: true,
          errorMessage: 'Device with this IMEI or Serial Number already exists',
        });

        throw new ConflictException(
          'Device with this IMEI or Serial Number already exists',
        );
      }

      const device = new this.deviceModel(createDeviceDto);
      const savedDevice = await device.save();

      await this.sendLog({
        method: 'POST',
        url: '/device-onboarding',
        statusCode: 201,
        operation: 'CREATE_DEVICE',
        resource: 'device-onboarding',
        message: 'Device created successfully',
        userId,
        metadata: {
          deviceId: savedDevice._id,
          deviceIMEI: savedDevice.deviceIMEI,
          deviceSerialNo: savedDevice.deviceSerialNo,
        },
        responseTime: Date.now() - startTime,
      });

      return savedDevice;
    } catch (error) {
      if (error.code === 11000) {
        await this.sendLog({
          method: 'POST',
          url: '/device-onboarding',
          statusCode: 409,
          operation: 'CREATE_DEVICE',
          resource: 'device-onboarding',
          message: 'Device creation failed - duplicate key error',
          userId,
          metadata: createDeviceDto,
          responseTime: Date.now() - startTime,
          isError: true,
          errorMessage: 'Device with this IMEI or Serial Number already exists',
          stackTrace: error.stack,
        });

        throw new ConflictException(
          'Device with this IMEI or Serial Number already exists',
        );
      }

      await this.sendLog({
        method: 'POST',
        url: '/device-onboarding',
        statusCode: 500,
        operation: 'CREATE_DEVICE',
        resource: 'device-onboarding',
        message: 'Device creation failed with unexpected error',
        userId,
        metadata: createDeviceDto,
        responseTime: Date.now() - startTime,
        isError: true,
        errorMessage: error.message,
        stackTrace: error.stack,
      });

      throw error;
    }
  }

  async findAll(
    query: DeviceOnboardingQueryDto,
    userId?: string,
  ): Promise<PaginatedResponse<any>> {
    const startTime = Date.now();

    try {
      const {
        page = 1,
        limit = 10,
        search,
        account,
        vehicle,
        driver,
        isActive,
        simOperator,
      } = query;
      const skip = (page - 1) * limit;

      // Build match conditions
      const matchConditions: any = {};

      if (account) matchConditions.account = new Types.ObjectId(account);
      if (vehicle) matchConditions.vehicle = new Types.ObjectId(vehicle);
      if (driver) matchConditions.driver = new Types.ObjectId(driver);
      if (typeof isActive === 'boolean') matchConditions.isActive = isActive;
      if (simOperator) {
        matchConditions.$or = [
          { simNo1Operator: { $regex: simOperator, $options: 'i' } },
          { simNo2Operator: { $regex: simOperator, $options: 'i' } },
        ];
      }

      // Search functionality
      if (search) {
        matchConditions.$or = [
          ...(matchConditions.$or || []),
          { deviceIMEI: { $regex: search, $options: 'i' } },
          { deviceSerialNo: { $regex: search, $options: 'i' } },
          { simNo1: { $regex: search, $options: 'i' } },
          { simNo2: { $regex: search, $options: 'i' } },
          { vehicleDescription: { $regex: search, $options: 'i' } },
          { simNo1Operator: { $regex: search, $options: 'i' } },
          { simNo2Operator: { $regex: search, $options: 'i' } },
        ];
      }

      const aggregationPipeline: any = [
        { $match: matchConditions },
        {
          $addFields: {
            account: { $toObjectId: '$account' },
            vehicle: { $toObjectId: '$vehicle' },
            driver: { $toObjectId: '$driver' },
            vehicleNo: { $toObjectId: '$vehicleNo' },
          },
        },
        {
          $lookup: {
            from: 'accounts',
            localField: 'account',
            foreignField: '_id',
            as: 'accountDetails',
          },
        },
        {
          $lookup: {
            from: 'vehiclemasters',
            localField: 'vehicle',
            foreignField: '_id',
            as: 'vehicleDetails',
          },
        },
        {
          $lookup: {
            from: 'drivers',
            localField: 'driver',
            foreignField: '_id',
            as: 'driverDetails',
          },
        },
        {
          $lookup: {
            from: 'vehicles',
            localField: 'vehicleNo',
            foreignField: '_id',
            as: 'vehcileNoDetails',
          },
        },
        {
          $addFields: {
            accountDetails: { $arrayElemAt: ['$accountDetails', 0] },
            vehicleDetails: { $arrayElemAt: ['$vehicleDetails', 0] },
            driverDetails: { $arrayElemAt: ['$driverDetails', 0] },
            vehcileNoDetails: { $arrayElemAt: ['$vehcileNoDetails', 0] },
          },
        },
        {
          $project: {
            _id: 1,
            deviceIMEI: 1,
            deviceSerialNo: 1,
            simNo1: 1,
            simNo2: 1,
            vehcileNo: 1,
            simNo1Operator: 1,
            simNo2Operator: 1,
            vehicleDescription: 1,
            isActive: 1,
            createdAt: 1,
            updatedAt: 1,
            accountDetails: {
              _id: 1,
              accountName: 1,
            },
            vehicleDetails: {
              _id: 1,
              vehicleNumber: 1,
            },
            driverDetails: {
              _id: 1,
              name: 1,
              licenseNo: 1,
              contactNo: 1,
            },
            vehcileNoDetails: {
              brandName: 1,
              modelName: 1,
              vehicleType: 1,
            },
          },
        },
        { $sort: { createdAt: -1 } },
      ];

      // Get total count
      const totalPipeline = [
        ...aggregationPipeline.slice(0, -1), // Remove sort stage for count
        { $count: 'total' },
      ];

      const [devices, totalResult] = await Promise.all([
        this.deviceModel.aggregate([
          ...aggregationPipeline,
          { $skip: Number(skip) },
          { $limit: Number(limit) },
        ]),
        this.deviceModel.aggregate(totalPipeline),
      ]);

      const total = totalResult[0]?.total || 0;
      const result = new PaginatedResponse(devices, page, limit, total);

      await this.sendLog({
        method: 'GET',
        url: '/device-onboarding',
        statusCode: 200,
        operation: 'LIST_DEVICES',
        resource: 'device-onboarding',
        message: 'Device list retrieved successfully',
        userId,
        metadata: {
          page,
          limit,
          total,
          filters: query,
          resultCount: devices.length,
        },
        responseTime: Date.now() - startTime,
      });

      return result;
    } catch (error) {
      await this.sendLog({
        method: 'GET',
        url: '/device-onboarding',
        statusCode: 500,
        operation: 'LIST_DEVICES',
        resource: 'device-onboarding',
        message: 'Failed to retrieve device list',
        userId,
        metadata: { query },
        responseTime: Date.now() - startTime,
        isError: true,
        errorMessage: error.message,
        stackTrace: error.stack,
      });

      throw error;
    }
  }

  async search(
    search: string,
    page = 1,
    limit = 10,
    userId?: string,
  ): Promise<PaginatedResponse<any>> {
    const startTime = Date.now();

    try {
      const skip = (page - 1) * limit;
      const regex = { $regex: search, $options: 'i' };

      const pipeline: any[] = [
        {
          $addFields: {
            account: { $toObjectId: '$account' },
            vehicle: { $toObjectId: '$vehicle' },
            driver: { $toObjectId: '$driver' },
            vehicleNo: { $toObjectId: '$vehicleNo' },
          },
        },
        {
          $lookup: {
            from: 'accounts',
            localField: 'account',
            foreignField: '_id',
            as: 'accountDetails',
          },
        },
        {
          $lookup: {
            from: 'vehiclemasters',
            localField: 'vehicle',
            foreignField: '_id',
            as: 'vehicleDetails',
          },
        },
        {
          $lookup: {
            from: 'drivers',
            localField: 'driver',
            foreignField: '_id',
            as: 'driverDetails',
          },
        },
        {
          $lookup: {
            from: 'vehicles',
            localField: 'vehicleNo',
            foreignField: '_id',
            as: 'vehcileNoDetails',
          },
        },
        {
          $addFields: {
            accountDetails: { $arrayElemAt: ['$accountDetails', 0] },
            vehicleDetails: { $arrayElemAt: ['$vehicleDetails', 0] },
            driverDetails: { $arrayElemAt: ['$driverDetails', 0] },
            vehcileNoDetails: { $arrayElemAt: ['$vehcileNoDetails', 0] },
          },
        },
        {
          $match: {
            $or: [
              { deviceIMEI: regex },
              { deviceSerialNo: regex },
              { simNo1: regex },
              { simNo2: regex },
              { simNo1Operator: regex },
              { simNo2Operator: regex },
              { vehicleDescription: regex },
              { 'accountDetails.accountName': regex },
              { 'vehicleDetails.vehicleNumber': regex },
              { 'driverDetails.name': regex },
              { 'driverDetails.licenseNo': regex },
              { 'driverDetails.contactNo': regex },
              { 'vehcileNoDetails.brandName': regex },
              { 'vehcileNoDetails.modelName': regex },
              { 'vehcileNoDetails.vehicleType': regex },
            ],
          },
        },
        {
          $project: {
            _id: 1,
            deviceIMEI: 1,
            deviceSerialNo: 1,
            simNo1: 1,
            simNo2: 1,
            vehcileNo: 1,
            simNo1Operator: 1,
            simNo2Operator: 1,
            vehicleDescription: 1,
            isActive: 1,
            createdAt: 1,
            updatedAt: 1,
            accountDetails: {
              _id: 1,
              accountName: 1,
            },
            vehicleDetails: {
              _id: 1,
              vehicleNumber: 1,
            },
            driverDetails: {
              _id: 1,
              name: 1,
              licenseNo: 1,
              contactNo: 1,
            },
            vehcileNoDetails: {
              brandName: 1,
              modelName: 1,
              vehicleType: 1,
            },
          },
        },
        { $sort: { createdAt: -1 } },
      ];

      const totalPipeline = [...pipeline, { $count: 'total' }];

      const [results, totalCount] = await Promise.all([
        this.deviceModel.aggregate([
          ...pipeline,
          { $skip: skip },
          { $limit: limit },
        ]),
        this.deviceModel.aggregate(totalPipeline),
      ]);

      const total = totalCount[0]?.total || 0;
      const result = new PaginatedResponse(results, page, limit, total);

      await this.sendLog({
        method: 'GET',
        url: '/device-onboarding/search',
        statusCode: 200,
        operation: 'SEARCH_DEVICES',
        resource: 'device-onboarding',
        message: 'Device search completed successfully',
        userId,
        metadata: {
          searchTerm: search,
          page,
          limit,
          total,
          resultCount: results.length,
        },
        responseTime: Date.now() - startTime,
      });

      return result;
    } catch (error) {
      await this.sendLog({
        method: 'GET',
        url: '/device-onboarding/search',
        statusCode: 500,
        operation: 'SEARCH_DEVICES',
        resource: 'device-onboarding',
        message: 'Device search failed',
        userId,
        metadata: { searchTerm: search, page, limit },
        responseTime: Date.now() - startTime,
        isError: true,
        errorMessage: error.message,
        stackTrace: error.stack,
      });

      throw error;
    }
  }

  async findOne(id: string, userId?: string): Promise<any> {
    const startTime = Date.now();

    try {
      if (!Types.ObjectId.isValid(id)) {
        await this.sendLog({
          method: 'GET',
          url: `/device-onboarding/${id}`,
          statusCode: 400,
          operation: 'GET_DEVICE',
          resource: 'device-onboarding',
          message: 'Invalid device ID format',
          userId,
          metadata: { deviceId: id },
          responseTime: Date.now() - startTime,
          isError: true,
          errorMessage: 'Invalid device ID',
        });

        throw new NotFoundException('Invalid device ID');
      }

      const device = await this.deviceModel.aggregate([
        { $match: { _id: new Types.ObjectId(id) } },
        {
          $addFields: {
            account: { $toObjectId: '$account' },
            vehicle: { $toObjectId: '$vehicle' },
            driver: { $toObjectId: '$driver' },
            vehicleNo: { $toObjectId: '$vehicleNo' },
          },
        },
        {
          $lookup: {
            from: 'accounts',
            localField: 'account',
            foreignField: '_id',
            as: 'accountDetails',
          },
        },
        {
          $lookup: {
            from: 'vehiclemasters',
            localField: 'vehicle',
            foreignField: '_id',
            as: 'vehicleDetails',
          },
        },
        {
          $lookup: {
            from: 'drivers',
            localField: 'driver',
            foreignField: '_id',
            as: 'driverDetails',
          },
        },
        {
          $lookup: {
            from: 'vehciles',
            localField: 'vehcileNo',
            foreignField: '_id',
            as: 'vehcileNoDetails',
          },
        },
        {
          $addFields: {
            accountDetails: { $arrayElemAt: ['$accountDetails', 0] },
            vehicleDetails: { $arrayElemAt: ['$vehicleDetails', 0] },
            driverDetails: { $arrayElemAt: ['$driverDetails', 0] },
            vehcileNoDetails: { $arrayElemAt: ['$vehcileNoDetails', 0] },
          },
        },
      ]);

      if (!device || device.length === 0) {
        await this.sendLog({
          method: 'GET',
          url: `/device-onboarding/${id}`,
          statusCode: 404,
          operation: 'GET_DEVICE',
          resource: 'device-onboarding',
          message: 'Device not found',
          userId,
          metadata: { deviceId: id },
          responseTime: Date.now() - startTime,
          isError: true,
          errorMessage: 'Device not found',
        });

        throw new NotFoundException('Device not found');
      }

      await this.sendLog({
        method: 'GET',
        url: `/device-onboarding/${id}`,
        statusCode: 200,
        operation: 'GET_DEVICE',
        resource: 'device-onboarding',
        message: 'Device retrieved successfully',
        userId,
        metadata: {
          deviceId: id,
          deviceIMEI: device[0].deviceIMEI,
        },
        responseTime: Date.now() - startTime,
      });

      return device[0];
    } catch (error) {
      if (!(error instanceof NotFoundException)) {
        await this.sendLog({
          method: 'GET',
          url: `/device-onboarding/${id}`,
          statusCode: 500,
          operation: 'GET_DEVICE',
          resource: 'device-onboarding',
          message: 'Unexpected error while retrieving device',
          userId,
          metadata: { deviceId: id },
          responseTime: Date.now() - startTime,
          isError: true,
          errorMessage: error.message,
          stackTrace: error.stack,
        });
      }

      throw error;
    }
  }

  async update(
    id: string,
    updateDeviceDto: UpdateDeviceOnboardingDto,
    userId?: string,
  ): Promise<any> {
    const startTime = Date.now();

    try {
      if (!Types.ObjectId.isValid(id)) {
        await this.sendLog({
          method: 'PATCH',
          url: `/device-onboarding/${id}`,
          statusCode: 400,
          operation: 'UPDATE_DEVICE',
          resource: 'device-onboarding',
          message: 'Invalid device ID format',
          userId,
          metadata: { deviceId: id, updateData: updateDeviceDto },
          responseTime: Date.now() - startTime,
          isError: true,
          errorMessage: 'Invalid device ID',
        });

        throw new NotFoundException('Invalid device ID');
      }

      // Check for duplicate IMEI or Serial Number if they are being updated
      if (updateDeviceDto.deviceIMEI || updateDeviceDto.deviceSerialNo) {
        const existingDevice = await this.deviceModel.findOne({
          _id: { $ne: id },
          $or: [
            ...(updateDeviceDto.deviceIMEI
              ? [{ deviceIMEI: updateDeviceDto.deviceIMEI }]
              : []),
            ...(updateDeviceDto.deviceSerialNo
              ? [{ deviceSerialNo: updateDeviceDto.deviceSerialNo }]
              : []),
          ],
        });

        if (existingDevice) {
          await this.sendLog({
            method: 'PATCH',
            url: `/device-onboarding/${id}`,
            statusCode: 409,
            operation: 'UPDATE_DEVICE',
            resource: 'device-onboarding',
            message: 'Device update failed - duplicate IMEI or Serial Number',
            userId,
            metadata: {
              deviceId: id,
              updateData: updateDeviceDto,
              conflictingDevice: existingDevice._id,
            },
            responseTime: Date.now() - startTime,
            isError: true,
            errorMessage:
              'Device with this IMEI or Serial Number already exists',
          });

          throw new ConflictException(
            'Device with this IMEI or Serial Number already exists',
          );
        }
      }

      const device = await this.deviceModel.findByIdAndUpdate(
        id,
        updateDeviceDto,
        { new: true, runValidators: true },
      );

      if (!device) {
        await this.sendLog({
          method: 'PATCH',
          url: `/device-onboarding/${id}`,
          statusCode: 404,
          operation: 'UPDATE_DEVICE',
          resource: 'device-onboarding',
          message: 'Device not found for update',
          userId,
          metadata: { deviceId: id, updateData: updateDeviceDto },
          responseTime: Date.now() - startTime,
          isError: true,
          errorMessage: 'Device not found',
        });

        throw new NotFoundException('Device not found');
      }

      await this.sendLog({
        method: 'PATCH',
        url: `/device-onboarding/${id}`,
        statusCode: 200,
        operation: 'UPDATE_DEVICE',
        resource: 'device-onboarding',
        message: 'Device updated successfully',
        userId,
        metadata: {
          deviceId: id,
          updateData: updateDeviceDto,
          deviceIMEI: device.deviceIMEI,
        },
        responseTime: Date.now() - startTime,
      });

      return device;
    } catch (error) {
      if (
        !(error instanceof NotFoundException) &&
        !(error instanceof ConflictException)
      ) {
        await this.sendLog({
          method: 'PATCH',
          url: `/device-onboarding/${id}`,
          statusCode: 500,
          operation: 'UPDATE_DEVICE',
          resource: 'device-onboarding',
          message: 'Unexpected error while updating device',
          userId,
          metadata: { deviceId: id, updateData: updateDeviceDto },
          responseTime: Date.now() - startTime,
          isError: true,
          errorMessage: error.message,
          stackTrace: error.stack,
        });
      }

      throw error;
    }
  }

  async deactivate(id: string, userId?: string): Promise<any> {
    const startTime = Date.now();

    try {
      if (!Types.ObjectId.isValid(id)) {
        await this.sendLog({
          method: 'PATCH',
          url: `/device-onboarding/${id}/deactivate`,
          statusCode: 400,
          operation: 'DEACTIVATE_DEVICE',
          resource: 'device-onboarding',
          message: 'Invalid device ID format',
          userId,
          metadata: { deviceId: id },
          responseTime: Date.now() - startTime,
          isError: true,
          errorMessage: 'Invalid device ID',
        });

        throw new NotFoundException('Invalid device ID');
      }

      const device = await this.deviceModel.findByIdAndUpdate(
        id,
        { isActive: false },
        { new: true },
      );

      if (!device) {
        await this.sendLog({
          method: 'PATCH',
          url: `/device-onboarding/${id}/deactivate`,
          statusCode: 404,
          operation: 'DEACTIVATE_DEVICE',
          resource: 'device-onboarding',
          message: 'Device not found for deactivation',
          userId,
          metadata: { deviceId: id },
          responseTime: Date.now() - startTime,
          isError: true,
          errorMessage: 'Device not found',
        });

        throw new NotFoundException('Device not found');
      }

      await this.sendLog({
        method: 'PATCH',
        url: `/device-onboarding/${id}/deactivate`,
        statusCode: 200,
        operation: 'DEACTIVATE_DEVICE',
        resource: 'device-onboarding',
        message: 'Device deactivated successfully',
        userId,
        metadata: {
          deviceId: id,
          deviceIMEI: device.deviceIMEI,
        },
        responseTime: Date.now() - startTime,
      });

      return device;
    } catch (error) {
      if (!(error instanceof NotFoundException)) {
        await this.sendLog({
          method: 'PATCH',
          url: `/device-onboarding/${id}/deactivate`,
          statusCode: 500,
          operation: 'DEACTIVATE_DEVICE',
          resource: 'device-onboarding',
          message: 'Unexpected error while deactivating device',
          userId,
          metadata: { deviceId: id },
          responseTime: Date.now() - startTime,
          isError: true,
          errorMessage: error.message,
          stackTrace: error.stack,
        });
      }

      throw error;
    }
  }

  async activate(id: string, userId?: string): Promise<any> {
    const startTime = Date.now();

    try {
      if (!Types.ObjectId.isValid(id)) {
        await this.sendLog({
          method: 'PATCH',
          url: `/device-onboarding/${id}/activate`,
          statusCode: 400,
          operation: 'ACTIVATE_DEVICE',
          resource: 'device-onboarding',
          message: 'Invalid device ID format',
          userId,
          metadata: { deviceId: id },
          responseTime: Date.now() - startTime,
          isError: true,
          errorMessage: 'Invalid device ID',
        });

        throw new NotFoundException('Invalid device ID');
      }

      const device = await this.deviceModel.findByIdAndUpdate(
        id,
        { isActive: true },
        { new: true },
      );

      if (!device) {
        await this.sendLog({
          method: 'PATCH',
          url: `/device-onboarding/${id}/activate`,
          statusCode: 404,
          operation: 'ACTIVATE_DEVICE',
          resource: 'device-onboarding',
          message: 'Device not found for activation',
          userId,
          metadata: { deviceId: id },
          responseTime: Date.now() - startTime,
          isError: true,
          errorMessage: 'Device not found',
        });

        throw new NotFoundException('Device not found');
      }

      await this.sendLog({
        method: 'PATCH',
        url: `/device-onboarding/${id}/activate`,
        statusCode: 200,
        operation: 'ACTIVATE_DEVICE',
        resource: 'device-onboarding',
        message: 'Device activated successfully',
        userId,
        metadata: {
          deviceId: id,
          deviceIMEI: device.deviceIMEI,
        },
        responseTime: Date.now() - startTime,
      });

      return device;
    } catch (error) {
      if (!(error instanceof NotFoundException)) {
        await this.sendLog({
          method: 'PATCH',
          url: `/device-onboarding/${id}/activate`,
          statusCode: 500,
          operation: 'ACTIVATE_DEVICE',
          resource: 'device-onboarding',
          message: 'Unexpected error while activating device',
          userId,
          metadata: { deviceId: id },
          responseTime: Date.now() - startTime,
          isError: true,
          errorMessage: error.message,
          stackTrace: error.stack,
        });
      }

      throw error;
    }
  }

  async remove(id: string, userId?: string): Promise<void> {
    const startTime = Date.now();

    try {
      if (!Types.ObjectId.isValid(id)) {
        await this.sendLog({
          method: 'DELETE',
          url: `/device-onboarding/${id}`,
          statusCode: 400,
          operation: 'DELETE_DEVICE',
          resource: 'device-onboarding',
          message: 'Invalid device ID format',
          userId,
          metadata: { deviceId: id },
          responseTime: Date.now() - startTime,
          isError: true,
          errorMessage: 'Invalid device ID',
        });

        throw new NotFoundException('Invalid device ID');
      }

      const result = await this.deviceModel.findByIdAndDelete(id);

      if (!result) {
        await this.sendLog({
          method: 'DELETE',
          url: `/device-onboarding/${id}`,
          statusCode: 404,
          operation: 'DELETE_DEVICE',
          resource: 'device-onboarding',
          message: 'Device not found for deletion',
          userId,
          metadata: { deviceId: id },
          responseTime: Date.now() - startTime,
          isError: true,
          errorMessage: 'Device not found',
        });

        throw new NotFoundException('Device not found');
      }

      await this.sendLog({
        method: 'DELETE',
        url: `/device-onboarding/${id}`,
        statusCode: 200,
        operation: 'DELETE_DEVICE',
        resource: 'device-onboarding',
        message: 'Device deleted successfully',
        userId,
        metadata: {
          deviceId: id,
          deviceIMEI: result.deviceIMEI,
        },
        responseTime: Date.now() - startTime,
      });
    } catch (error) {
      if (!(error instanceof NotFoundException)) {
        await this.sendLog({
          method: 'DELETE',
          url: `/device-onboarding/${id}`,
          statusCode: 500,
          operation: 'DELETE_DEVICE',
          resource: 'device-onboarding',
          message: 'Unexpected error while deleting device',
          userId,
          metadata: { deviceId: id },
          responseTime: Date.now() - startTime,
          isError: true,
          errorMessage: error.message,
          stackTrace: error.stack,
        });
      }

      throw error;
    }
  }

  // Export methods
  async findAllWithoutPagination(userId?: string): Promise<any[]> {
    const startTime = Date.now();

    try {
      const devices = await this.deviceModel.aggregate([
        {
          $addFields: {
            account: { $toObjectId: '$account' },
            vehicle: { $toObjectId: '$vehicle' },
            driver: { $toObjectId: '$driver' },
            vehicleNo: { $toObjectId: '$vehicleNo' },
          },
        },
        {
          $lookup: {
            from: 'accounts',
            localField: 'account',
            foreignField: '_id',
            as: 'accountDetails',
          },
        },
        {
          $lookup: {
            from: 'vehiclemasters',
            localField: 'vehicle',
            foreignField: '_id',
            as: 'vehicleDetails',
          },
        },
        {
          $lookup: {
            from: 'drivers',
            localField: 'driver',
            foreignField: '_id',
            as: 'driverDetails',
          },
        },
        {
          $lookup: {
            from: 'vehicles',
            localField: 'vehicleNo',
            foreignField: '_id',
            as: 'vehcileNoDetails',
          },
        },
        {
          $addFields: {
            accountDetails: { $arrayElemAt: ['$accountDetails', 0] },
            vehicleDetails: { $arrayElemAt: ['$vehicleDetails', 0] },
            driverDetails: { $arrayElemAt: ['$driverDetails', 0] },
            vehcileNoDetails: { $arrayElemAt: ['$vehcileNoDetails', 0] },
          },
        },
        {
          $project: {
            _id: 1,
            deviceIMEI: 1,
            deviceSerialNo: 1,
            simNo1: 1,
            simNo2: 1,
            vehcileNo: 1,
            simNo1Operator: 1,
            simNo2Operator: 1,
            vehicleDescription: 1,
            isActive: 1,
            createdAt: 1,
            updatedAt: 1,
            accountDetails: {
              _id: 1,
              accountName: 1,
            },
            vehicleDetails: {
              _id: 1,
              vehicleNumber: 1,
            },
            driverDetails: {
              _id: 1,
              name: 1,
              licenseNo: 1,
              contactNo: 1,
            },
            vehcileNoDetails: {
              brandName: 1,
              modelName: 1,
              vehicleType: 1,
            },
          },
        },
        { $sort: { createdAt: -1 } },
      ]);

      await this.sendLog({
        method: 'GET',
        url: '/device-onboarding/export/data',
        statusCode: 200,
        operation: 'EXPORT_DEVICES_DATA',
        resource: 'device-onboarding',
        message: 'Device export data retrieved successfully',
        userId,
        metadata: {
          totalDevices: devices.length,
        },
        responseTime: Date.now() - startTime,
      });

      return devices;
    } catch (error) {
      await this.sendLog({
        method: 'GET',
        url: '/device-onboarding/export/data',
        statusCode: 500,
        operation: 'EXPORT_DEVICES_DATA',
        resource: 'device-onboarding',
        message: 'Failed to retrieve device export data',
        userId,
        responseTime: Date.now() - startTime,
        isError: true,
        errorMessage: error.message,
        stackTrace: error.stack,
      });

      throw error;
    }
  }

  exportToPDF(devices: any[], res: Response, userId?: string): void {
    const startTime = Date.now();

    try {
      // Create a document with margins
      const doc = new PDFDocument({ margin: 30 });

      // Set response headers for PDF download
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader(
        'Content-Disposition',
        'attachment; filename=device-onboarding.pdf',
      );

      doc.pipe(res);

      // Title
      doc
        .fontSize(18)
        .text('Device Onboarding List', { align: 'center' })
        .moveDown(1);

      // Define table structure
      const table = {
        headers: [
          { label: 'Device IMEI', width: 110 },
          { label: 'Serial No', width: 90 },
          { label: 'SIM 1', width: 80 },
          { label: 'SIM 2', width: 80 },
          { label: 'Account', width: 100 },
          { label: 'Vehicle', width: 90 },
          { label: 'Status', width: 60 },
        ],
        rows: devices.map((device) => [
          device.deviceIMEI || '',
          device.deviceSerialNo || '',
          device.simNo1 || '',
          device.simNo2 || '',
          device.accountDetails?.accountName || '',
          device.vehicleDetails?.vehicleNumber || '',
          device.isActive ? 'Active' : 'Inactive',
        ]),
        rowHeight: 25,
        margin: { top: 40 },
      };

      // Table drawing position
      const startY = doc.y + table.margin.top;
      let currentY = startY;

      // Draw table headers
      doc.font('Helvetica-Bold').fontSize(9);
      let x = doc.page.margins.left;

      table.headers.forEach((header, i) => {
        doc.text(header.label, x, currentY, {
          width: header.width,
          align: 'left',
        });
        x += header.width;
      });

      currentY += table.rowHeight;

      // Draw horizontal line under headers
      doc
        .moveTo(doc.page.margins.left, currentY - 5)
        .lineTo(doc.page.width - doc.page.margins.right, currentY - 5)
        .stroke();

      // Draw table rows
      doc.font('Helvetica').fontSize(8);

      table.rows.forEach((row, rowIndex) => {
        x = doc.page.margins.left;
        let maxHeightInRow = 0;

        // Draw each cell in the row
        row.forEach((cell, colIndex) => {
          const cellHeight = doc.heightOfString(cell, {
            width: table.headers[colIndex].width,
          });

          maxHeightInRow = Math.max(maxHeightInRow, cellHeight);

          doc.text(cell, x, currentY, {
            width: table.headers[colIndex].width,
            align: 'left',
          });

          x += table.headers[colIndex].width;
        });

        currentY += maxHeightInRow + 10;

        // Add a new page if we're at the bottom
        if (currentY > doc.page.height - doc.page.margins.bottom) {
          doc.addPage();
          currentY = doc.page.margins.top;
        }
      });

      doc.end();

      // Log successful PDF export
      this.sendLog({
        method: 'GET',
        url: '/device-onboarding/export/pdf',
        statusCode: 200,
        operation: 'EXPORT_DEVICES_PDF',
        resource: 'device-onboarding',
        message: 'Device list exported to PDF successfully',
        userId,
        metadata: {
          totalDevices: devices.length,
          exportFormat: 'PDF',
        },
        responseTime: Date.now() - startTime,
      });
    } catch (error) {
      console.error('Error exporting to PDF:', error);

      this.sendLog({
        method: 'GET',
        url: '/device-onboarding/export/pdf',
        statusCode: 500,
        operation: 'EXPORT_DEVICES_PDF',
        resource: 'device-onboarding',
        message: 'Failed to export device list to PDF',
        userId,
        metadata: {
          totalDevices: devices.length,
          exportFormat: 'PDF',
        },
        responseTime: Date.now() - startTime,
        isError: true,
        errorMessage: error.message,
        stackTrace: error.stack,
      });

      if (!res.headersSent) {
        res.status(500).send('Error generating PDF');
      }
    }
  }

  exportToCSV(devices: any[], res: Response, userId?: string): void {
    const startTime = Date.now();

    try {
      // Set response headers
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader(
        'Content-Disposition',
        'attachment; filename=device-onboarding_' +
          new Date().toISOString().slice(0, 10) +
          '.csv',
      );

      // CSV configuration
      const csvStream = format({
        headers: [
          'Device IMEI',
          'Serial Number',
          'SIM 1',
          'SIM 2',
          'SIM 1 Operator',
          'SIM 2 Operator',
          'Vehicle Description',
          'Account Name',
          'Vehicle Number',
          'Driver Name',
          'Driver License',
          'Driver Contact',
          'Status',
          'Created At',
        ],
        writeHeaders: true,
        delimiter: ',',
        quote: '"',
        escape: '"',
        includeEndRowDelimiter: true,
      });

      // Pipe CSV stream to response
      csvStream.pipe(res);

      // Write data rows
      devices.forEach((device) => {
        csvStream.write({
          'Device IMEI': device.deviceIMEI || 'N/A',
          'Serial Number': device.deviceSerialNo || 'N/A',
          'SIM 1': device.simNo1 || 'N/A',
          'SIM 2': device.simNo2 || 'N/A',
          'SIM 1 Operator': device.simNo1Operator || 'N/A',
          'SIM 2 Operator': device.simNo2Operator || 'N/A',
          'Vehicle Description': device.vehicleDescription || 'N/A',
          'Account Name': device.accountDetails?.accountName || 'N/A',
          'Vehicle Number': device.vehicleDetails?.vehicleNumber || 'N/A',
          'Driver Name': device.driverDetails?.name || 'N/A',
          'Driver License': device.driverDetails?.licenseNo || 'N/A',
          'Driver Contact': device.driverDetails?.contactNo || 'N/A',
          Status: device.isActive ? 'ACTIVE' : 'INACTIVE',
          'Created At': device.createdAt
            ? new Date(device.createdAt).toLocaleString()
            : 'N/A',
        });
      });

      // Handle stream events
      csvStream.on('error', (error) => {
        console.error('CSV stream error:', error);

        this.sendLog({
          method: 'GET',
          url: '/device-onboarding/export/csv',
          statusCode: 500,
          operation: 'EXPORT_DEVICES_CSV',
          resource: 'device-onboarding',
          message: 'CSV stream error during export',
          userId,
          metadata: {
            totalDevices: devices.length,
            exportFormat: 'CSV',
          },
          responseTime: Date.now() - startTime,
          isError: true,
          errorMessage: error.message,
          stackTrace: error.stack,
        });

        if (!res.headersSent) {
          res.status(500).send('Error generating CSV');
        }
      });

      csvStream.on('end', () => {
        console.log('CSV export completed successfully');

        this.sendLog({
          method: 'GET',
          url: '/device-onboarding/export/csv',
          statusCode: 200,
          operation: 'EXPORT_DEVICES_CSV',
          resource: 'device-onboarding',
          message: 'Device list exported to CSV successfully',
          userId,
          metadata: {
            totalDevices: devices.length,
            exportFormat: 'CSV',
          },
          responseTime: Date.now() - startTime,
        });
      });

      csvStream.end();
    } catch (error) {
      console.error('Error in exportToCSV:', error);

      this.sendLog({
        method: 'GET',
        url: '/device-onboarding/export/csv',
        statusCode: 500,
        operation: 'EXPORT_DEVICES_CSV',
        resource: 'device-onboarding',
        message: 'Failed to export device list to CSV',
        userId,
        metadata: {
          totalDevices: devices.length,
          exportFormat: 'CSV',
        },
        responseTime: Date.now() - startTime,
        isError: true,
        errorMessage: error.message,
        stackTrace: error.stack,
      });

      if (!res.headersSent) {
        res.status(500).send('Internal Server Error');
      }
    }
  }

  async exportToXLSX(
    devices: any[],
    res: Response,
    userId?: string,
  ): Promise<void> {
    const startTime = Date.now();

    try {
      const workbook = new ExcelJS.Workbook();
      workbook.creator = 'Device Onboarding System';
      workbook.created = new Date();

      const worksheet = workbook.addWorksheet('Device Onboarding', {
        pageSetup: {
          orientation: 'landscape',
          fitToPage: true,
          fitToWidth: 1,
        },
      });

      // Define columns with specific widths and styles
      worksheet.columns = [
        {
          header: 'Device IMEI',
          key: 'deviceIMEI',
          width: 20,
          style: { numFmt: '@' },
        },
        { header: 'Serial Number', key: 'deviceSerialNo', width: 20 },
        { header: 'SIM 1', key: 'simNo1', width: 15 },
        { header: 'SIM 2', key: 'simNo2', width: 15 },
        { header: 'SIM 1 Operator', key: 'simNo1Operator', width: 15 },
        { header: 'SIM 2 Operator', key: 'simNo2Operator', width: 15 },
        { header: 'Vehicle Description', key: 'vehicleDescription', width: 25 },
        { header: 'Account Name', key: 'accountName', width: 20 },
        { header: 'Vehicle Number', key: 'vehicleNumber', width: 15 },
        { header: 'Driver Name', key: 'driverName', width: 20 },
        { header: 'Driver License', key: 'driverLicense', width: 15 },
        { header: 'Driver Contact', key: 'driverContact', width: 15 },
        { header: 'Status', key: 'status', width: 10 },
        {
          header: 'Created At',
          key: 'createdAt',
          width: 20,
          style: { numFmt: 'yyyy-mm-dd hh:mm:ss' },
        },
      ];

      // Add header style
      worksheet.getRow(1).eachCell((cell) => {
        cell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FF4472C4' }, // Blue background
        };
        cell.font = {
          bold: true,
          color: { argb: 'FFFFFFFF' }, // White text
        };
        cell.alignment = {
          vertical: 'middle',
          horizontal: 'center',
          wrapText: true,
        };
        cell.border = {
          top: { style: 'thin' },
          left: { style: 'thin' },
          bottom: { style: 'thin' },
          right: { style: 'thin' },
        };
      });

      // Add data rows with conditional formatting
      devices.forEach((device) => {
        const row = worksheet.addRow({
          deviceIMEI: device.deviceIMEI || 'N/A',
          deviceSerialNo: device.deviceSerialNo || 'N/A',
          simNo1: device.simNo1 || 'N/A',
          simNo2: device.simNo2 || 'N/A',
          simNo1Operator: device.simNo1Operator || 'N/A',
          simNo2Operator: device.simNo2Operator || 'N/A',
          vehicleDescription: device.vehicleDescription || 'N/A',
          accountName: device.accountDetails?.accountName || 'N/A',
          vehicleNumber: device.vehicleDetails?.vehicleNumber || 'N/A',
          driverName: device.driverDetails?.name || 'N/A',
          driverLicense: device.driverDetails?.licenseNo || 'N/A',
          driverContact: device.driverDetails?.contactNo || 'N/A',
          status: device.isActive ? 'ACTIVE' : 'INACTIVE',
          createdAt: device.createdAt,
        });

        // Style the data rows
        row.eachCell((cell) => {
          cell.border = {
            top: { style: 'thin' },
            left: { style: 'thin' },
            bottom: { style: 'thin' },
            right: { style: 'thin' },
          };

          // Highlight active devices
          if (cell.value === 'ACTIVE') {
            cell.fill = {
              type: 'pattern',
              pattern: 'solid',
              fgColor: { argb: 'FFC6EFCE' }, // Light green
            };
          }
        });
      });

      // Freeze header row
      worksheet.views = [{ state: 'frozen', ySplit: 1 }];

      // Auto-filter
      worksheet.autoFilter = {
        from: { row: 1, column: 1 },
        to: { row: 1, column: worksheet.columnCount },
      };

      // Set response headers
      res.setHeader(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      );
      res.setHeader(
        'Content-Disposition',
        `attachment; filename=device-onboarding_${new Date().toISOString().slice(0, 10)}.xlsx`,
      );

      await workbook.xlsx.write(res);
      res.end();

      await this.sendLog({
        method: 'GET',
        url: '/device-onboarding/export/xlsx',
        statusCode: 200,
        operation: 'EXPORT_DEVICES_XLSX',
        resource: 'device-onboarding',
        message: 'Device list exported to XLSX successfully',
        userId,
        metadata: {
          totalDevices: devices.length,
          exportFormat: 'XLSX',
        },
        responseTime: Date.now() - startTime,
      });
    } catch (error) {
      console.error('Error exporting to XLSX:', error);

      await this.sendLog({
        method: 'GET',
        url: '/device-onboarding/export/xlsx',
        statusCode: 500,
        operation: 'EXPORT_DEVICES_XLSX',
        resource: 'device-onboarding',
        message: 'Failed to export device list to XLSX',
        userId,
        metadata: {
          totalDevices: devices.length,
          exportFormat: 'XLSX',
        },
        responseTime: Date.now() - startTime,
        isError: true,
        errorMessage: error.message,
        stackTrace: error.stack,
      });

      if (!res.headersSent) {
        res.status(500).send('Error generating Excel file');
      }
    }
  }

  // Additional utility methods
  async getDevicesByAccount(
    accountId: string,
    userId?: string,
  ): Promise<any[]> {
    const startTime = Date.now();

    try {
      if (!Types.ObjectId.isValid(accountId)) {
        await this.sendLog({
          method: 'GET',
          url: `/device-onboarding/account/${accountId}`,
          statusCode: 400,
          operation: 'GET_DEVICES_BY_ACCOUNT',
          resource: 'device-onboarding',
          message: 'Invalid account ID format',
          userId,
          metadata: { accountId },
          responseTime: Date.now() - startTime,
          isError: true,
          errorMessage: 'Invalid account ID',
        });

        throw new NotFoundException('Invalid account ID');
      }

      const devices = await this.deviceModel
        .find({
          account: new Types.ObjectId(accountId),
          isActive: true,
        })
        .populate(['vehicle', 'driver']);

      await this.sendLog({
        method: 'GET',
        url: `/device-onboarding/account/${accountId}`,
        statusCode: 200,
        operation: 'GET_DEVICES_BY_ACCOUNT',
        resource: 'device-onboarding',
        message: 'Devices retrieved by account successfully',
        userId,
        metadata: {
          accountId,
          deviceCount: devices.length,
        },
        responseTime: Date.now() - startTime,
      });

      return devices;
    } catch (error) {
      if (!(error instanceof NotFoundException)) {
        await this.sendLog({
          method: 'GET',
          url: `/device-onboarding/account/${accountId}`,
          statusCode: 500,
          operation: 'GET_DEVICES_BY_ACCOUNT',
          resource: 'device-onboarding',
          message: 'Failed to retrieve devices by account',
          userId,
          metadata: { accountId },
          responseTime: Date.now() - startTime,
          isError: true,
          errorMessage: error.message,
          stackTrace: error.stack,
        });
      }

      throw error;
    }
  }

  async getDevicesByVehicle(
    vehicleId: string,
    userId?: string,
  ): Promise<any[]> {
    const startTime = Date.now();

    try {
      if (!Types.ObjectId.isValid(vehicleId)) {
        await this.sendLog({
          method: 'GET',
          url: `/device-onboarding/vehicle/${vehicleId}`,
          statusCode: 400,
          operation: 'GET_DEVICES_BY_VEHICLE',
          resource: 'device-onboarding',
          message: 'Invalid vehicle ID format',
          userId,
          metadata: { vehicleId },
          responseTime: Date.now() - startTime,
          isError: true,
          errorMessage: 'Invalid vehicle ID',
        });

        throw new NotFoundException('Invalid vehicle ID');
      }

      const devices = await this.deviceModel
        .find({
          vehicle: new Types.ObjectId(vehicleId),
          isActive: true,
        })
        .populate(['account', 'driver']);

      await this.sendLog({
        method: 'GET',
        url: `/device-onboarding/vehicle/${vehicleId}`,
        statusCode: 200,
        operation: 'GET_DEVICES_BY_VEHICLE',
        resource: 'device-onboarding',
        message: 'Devices retrieved by vehicle successfully',
        userId,
        metadata: {
          vehicleId,
          deviceCount: devices.length,
        },
        responseTime: Date.now() - startTime,
      });

      return devices;
    } catch (error) {
      if (!(error instanceof NotFoundException)) {
        await this.sendLog({
          method: 'GET',
          url: `/device-onboarding/vehicle/${vehicleId}`,
          statusCode: 500,
          operation: 'GET_DEVICES_BY_VEHICLE',
          resource: 'device-onboarding',
          message: 'Failed to retrieve devices by vehicle',
          userId,
          metadata: { vehicleId },
          responseTime: Date.now() - startTime,
          isError: true,
          errorMessage: error.message,
          stackTrace: error.stack,
        });
      }

      throw error;
    }
  }

  async getDeviceStats(userId?: string): Promise<any> {
    const startTime = Date.now();

    try {
      const stats = await this.deviceModel.aggregate([
        {
          $group: {
            _id: null,
            totalDevices: { $sum: 1 },
            activeDevices: {
              $sum: { $cond: ['$isActive', 1, 0] },
            },
            inactiveDevices: {
              $sum: { $cond: ['$isActive', 0, 1] },
            },
          },
        },
        {
          $project: {
            _id: 0,
            totalDevices: 1,
            activeDevices: 1,
            inactiveDevices: 1,
          },
        },
      ]);

      await this.sendLog({
        method: 'GET',
        url: '/device-onboarding/stats',
        statusCode: 200,
        operation: 'GET_DEVICE_STATS',
        resource: 'device-onboarding',
        message: 'Device statistics retrieved successfully',
        userId,
        metadata: {
          stats: stats[0] || {
            totalDevices: 0,
            activeDevices: 0,
            inactiveDevices: 0,
          },
        },
        responseTime: Date.now() - startTime,
      });

      return stats;
    } catch (error) {
      await this.sendLog({
        method: 'GET',
        url: '/device-onboarding/stats',
        statusCode: 500,
        operation: 'GET_DEVICE_STATS',
        resource: 'device-onboarding',
        message: 'Failed to retrieve device statistics',
        userId,
        responseTime: Date.now() - startTime,
        isError: true,
        errorMessage: error.message,
        stackTrace: error.stack,
      });

      throw error;
    }
  }
}
