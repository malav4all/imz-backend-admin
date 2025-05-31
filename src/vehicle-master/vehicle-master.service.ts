import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Response } from 'express';
import * as PDFDocument from 'pdfkit';
import * as ExcelJS from 'exceljs';
import { format } from '@fast-csv/format';
import axios from 'axios';
import { UpdateVehicleMasterDto } from './dto/update-vehicle-master.dto';
import { SearchVehicleMasterDto } from './dto/search-vehicle-master.dto';
import {
  VehicleMaster,
  VehicleMasterDocument,
} from './schema/vehicle-master.schema';
import { Vehicle, VehicleDocument } from './schema/vehicle.schema';
import { Driver, DriverDocument } from './schema/driver.schema';
import { CreateVehicleMasterDto } from './dto/create-vehcile-master.dto';
import { PaginatedResponse } from 'src/comman/pagination.dto';

@Injectable()
export class VehicleMasterService {
  private readonly logger = new Logger(VehicleMasterService.name);
  private readonly logsServiceUrl =
    process.env.LOGS_SERVICE_URL || 'http://localhost:9008/logs';

  constructor(
    @InjectModel(VehicleMaster.name)
    private vehicleMasterModel: Model<VehicleMasterDocument>,
    @InjectModel(Vehicle.name) private vehicleModel: Model<VehicleDocument>,
    @InjectModel(Driver.name) private driverModel: Model<DriverDocument>,
  ) {}

  async create(
    createVehicleMasterDto: CreateVehicleMasterDto,
    userId?: string,
  ): Promise<VehicleMaster> {
    const startTime = Date.now();

    try {
      this.logger.log(
        `Creating vehicle master: ${createVehicleMasterDto.vehicleNumber}`,
      );

      const existingVehicleMaster = await this.vehicleMasterModel.findOne({
        $or: [
          { vehicleNumber: createVehicleMasterDto.vehicleNumber },
          { chassisNumber: createVehicleMasterDto.chassisNumber },
          { engineNumber: createVehicleMasterDto.engineNumber },
        ],
      });

      if (existingVehicleMaster) {
        const errorMessage =
          'Vehicle Master with this vehicle number, chassis number, or engine number already exists';

        // Determine which field caused the conflict
        let conflictField = '';
        let conflictValue = '';
        if (
          existingVehicleMaster.vehicleNumber ===
          createVehicleMasterDto.vehicleNumber
        ) {
          conflictField = 'vehicleNumber';
          conflictValue = createVehicleMasterDto.vehicleNumber;
        } else if (
          existingVehicleMaster.chassisNumber ===
          createVehicleMasterDto.chassisNumber
        ) {
          conflictField = 'chassisNumber';
          conflictValue = createVehicleMasterDto.chassisNumber;
        } else if (
          existingVehicleMaster.engineNumber ===
          createVehicleMasterDto.engineNumber
        ) {
          conflictField = 'engineNumber';
          conflictValue = createVehicleMasterDto.engineNumber;
        }

        // 📝 Log conflict error
        await this.sendLog({
          method: 'POST',
          url: '/api/vehicle-masters',
          statusCode: 409,
          operation: 'CREATE',
          resource: 'VEHICLE_MASTER',
          message: 'Vehicle Master creation failed - duplicate field',
          userId,
          metadata: {
            requestData: createVehicleMasterDto,
            conflictField,
            conflictValue,
            errorType: 'DUPLICATE_FIELD',
          },
          responseTime: Date.now() - startTime,
          isError: true,
          errorMessage,
        });

        throw new ConflictException(errorMessage);
      }

      const vehicle = await this.vehicleModel.findById(
        createVehicleMasterDto.vehicleModule,
      );
      if (!vehicle) {
        const errorMessage = 'Vehicle Module not found';

        // 📝 Log vehicle not found error
        await this.sendLog({
          method: 'POST',
          url: '/api/vehicle-masters',
          statusCode: 404,
          operation: 'CREATE',
          resource: 'VEHICLE_MASTER',
          message: 'Vehicle Master creation failed - vehicle module not found',
          userId,
          metadata: {
            requestData: createVehicleMasterDto,
            vehicleModuleId: createVehicleMasterDto.vehicleModule,
            errorType: 'VEHICLE_NOT_FOUND',
          },
          responseTime: Date.now() - startTime,
          isError: true,
          errorMessage,
        });

        throw new NotFoundException(errorMessage);
      }

      // Validate driver module exists
      const driver = await this.driverModel.findById(
        createVehicleMasterDto.driverModule,
      );
      if (!driver) {
        const errorMessage = 'Driver Module not found';

        // 📝 Log driver not found error
        await this.sendLog({
          method: 'POST',
          url: '/api/vehicle-masters',
          statusCode: 404,
          operation: 'CREATE',
          resource: 'VEHICLE_MASTER',
          message: 'Vehicle Master creation failed - driver module not found',
          userId,
          metadata: {
            requestData: createVehicleMasterDto,
            driverModuleId: createVehicleMasterDto.driverModule,
            errorType: 'DRIVER_NOT_FOUND',
          },
          responseTime: Date.now() - startTime,
          isError: true,
          errorMessage,
        });

        throw new NotFoundException(errorMessage);
      }

      const vehicleMaster = new this.vehicleMasterModel(createVehicleMasterDto);
      const savedVehicleMaster = await vehicleMaster.save();

      // 📝 Log successful creation
      await this.sendLog({
        method: 'POST',
        url: '/api/vehicle-masters',
        statusCode: 201,
        operation: 'CREATE',
        resource: 'VEHICLE_MASTER',
        message: `Vehicle Master created successfully: ${savedVehicleMaster.vehicleNumber}`,
        userId,
        metadata: {
          vehicleMasterId: savedVehicleMaster._id,
          vehicleNumber: savedVehicleMaster.vehicleNumber,
          chassisNumber: savedVehicleMaster.chassisNumber,
          engineNumber: savedVehicleMaster.engineNumber,
          vehicleModuleId: savedVehicleMaster.vehicleModule,
          driverModuleId: savedVehicleMaster.driverModule,
          requestData: createVehicleMasterDto,
        },
        responseTime: Date.now() - startTime,
      });

      this.logger.log(
        `Vehicle Master created successfully with ID: ${savedVehicleMaster._id}`,
      );
      return savedVehicleMaster;
    } catch (error) {
      // Re-throw known exceptions (already logged above)
      if (
        error instanceof ConflictException ||
        error instanceof NotFoundException
      ) {
        throw error;
      }

      // 📝 Log other errors
      await this.sendLog({
        method: 'POST',
        url: '/api/vehicle-masters',
        statusCode: 500,
        operation: 'CREATE',
        resource: 'VEHICLE_MASTER',
        message: `Vehicle Master creation failed: ${error.message}`,
        userId,
        metadata: {
          requestData: createVehicleMasterDto,
          errorType: error.name,
        },
        responseTime: Date.now() - startTime,
        isError: true,
        errorMessage: error.message,
        stackTrace: error.stack,
      });

      this.logger.error(
        `Failed to create vehicle master: ${error.message}`,
        error.stack,
      );
      throw error;
    }
  }

  async findAll(
    searchDto: SearchVehicleMasterDto,
    userId?: string,
  ): Promise<PaginatedResponse<any>> {
    const startTime = Date.now();

    try {
      this.logger.log(
        `Retrieving vehicle masters - Page: ${searchDto.page}, Limit: ${searchDto.limit}, Search: "${searchDto.searchText}"`,
      );

      const { page = 1, limit = 10, searchText } = searchDto;
      const pageNum = Number(page);
      const limitNum = Number(limit);
      const skip = (pageNum - 1) * limitNum;

      // Build match conditions
      const matchConditions: any = {};

      // Aggregation pipeline with vehicle and driver joins
      const pipeline: any = [
        { $match: matchConditions },
        // Convert string IDs to ObjectIds if needed
        {
          $addFields: {
            vehicleModule: {
              $cond: {
                if: { $type: '$vehicleModule' },
                then: { $toObjectId: '$vehicleModule' },
                else: '$vehicleModule',
              },
            },
            driverModule: {
              $cond: {
                if: { $type: '$driverModule' },
                then: { $toObjectId: '$driverModule' },
                else: '$driverModule',
              },
            },
          },
        },
        // Join with Vehicle Module
        {
          $lookup: {
            from: 'vehicles',
            localField: 'vehicleModule',
            foreignField: '_id',
            as: 'vehicleInfo',
          },
        },
        {
          $unwind: {
            path: '$vehicleInfo',
            preserveNullAndEmptyArrays: true,
          },
        },
        // Join with Driver Module
        {
          $lookup: {
            from: 'drivers',
            localField: 'driverModule',
            foreignField: '_id',
            as: 'driverInfo',
          },
        },
        {
          $unwind: {
            path: '$driverInfo',
            preserveNullAndEmptyArrays: true,
          },
        },

        ...(searchText
          ? [
              {
                $match: {
                  $or: [
                    { vehicleNumber: { $regex: searchText, $options: 'i' } },
                    { chassisNumber: { $regex: searchText, $options: 'i' } },
                    { engineNumber: { $regex: searchText, $options: 'i' } },
                    {
                      'vehicleInfo.brand': {
                        $regex: searchText,
                        $options: 'i',
                      },
                    },
                    {
                      'vehicleInfo.model': {
                        $regex: searchText,
                        $options: 'i',
                      },
                    },
                    {
                      'driverInfo.name': { $regex: searchText, $options: 'i' },
                    },
                    {
                      'driverInfo.licenseNumber': {
                        $regex: searchText,
                        $options: 'i',
                      },
                    },
                  ],
                },
              },
            ]
          : []),
        { $sort: { createdAt: -1 } },
      ];

      // Get total count
      const countPipeline = [...pipeline, { $count: 'total' }];

      const [vehicleMasters, totalResult] = await Promise.all([
        this.vehicleMasterModel.aggregate([
          ...pipeline,
          { $skip: skip },
          { $limit: limitNum },
        ]),
        this.vehicleMasterModel.aggregate(countPipeline),
      ]);

      const total = totalResult[0]?.total || 0;
      const result = new PaginatedResponse(vehicleMasters, page, limit, total);

      // 📝 Log successful retrieval
      await this.sendLog({
        method: 'GET',
        url: '/api/vehicle-masters',
        statusCode: 200,
        operation: searchText ? 'SEARCH' : 'READ',
        resource: 'VEHICLE_MASTER',
        message: searchText
          ? `Vehicle Master search completed - found ${vehicleMasters.length} records`
          : `Successfully retrieved ${vehicleMasters.length} vehicle masters`,
        userId,
        metadata: {
          searchText: searchText || '',
          page: pageNum,
          limit: limitNum,
          retrievedCount: vehicleMasters.length,
          totalCount: total,
          hasSearch: !!searchText,
        },
        responseTime: Date.now() - startTime,
      });

      this.logger.log(
        `Retrieved ${vehicleMasters.length} vehicle masters out of ${total} total`,
      );
      return result;
    } catch (error) {
      // 📝 Log error
      await this.sendLog({
        method: 'GET',
        url: '/api/vehicle-masters',
        statusCode: 500,
        operation: searchDto.searchText ? 'SEARCH' : 'READ',
        resource: 'VEHICLE_MASTER',
        message: `Failed to retrieve vehicle masters: ${error.message}`,
        userId,
        metadata: {
          searchText: searchDto.searchText || '',
          page: searchDto.page,
          limit: searchDto.limit,
        },
        responseTime: Date.now() - startTime,
        isError: true,
        errorMessage: error.message,
        stackTrace: error.stack,
      });

      this.logger.error(
        `Failed to retrieve vehicle masters: ${error.message}`,
        error.stack,
      );
      throw error;
    }
  }

  async findOne(id: string, userId?: string): Promise<any> {
    const startTime = Date.now();

    try {
      this.logger.log(`Finding vehicle master with ID: ${id}`);

      if (!Types.ObjectId.isValid(id)) {
        const errorMessage = 'Invalid Vehicle Master ID';

        // 📝 Log invalid ID error
        await this.sendLog({
          method: 'GET',
          url: `/api/vehicle-masters/${id}`,
          statusCode: 400,
          operation: 'READ',
          resource: 'VEHICLE_MASTER',
          message: 'Vehicle Master lookup failed - invalid ID format',
          userId,
          metadata: { vehicleMasterId: id },
          responseTime: Date.now() - startTime,
          isError: true,
          errorMessage,
        });

        throw new NotFoundException(errorMessage);
      }

      const vehicleMaster = await this.vehicleMasterModel.aggregate([
        { $match: { _id: new Types.ObjectId(id) } },
        // Convert string IDs to ObjectIds if needed
        {
          $addFields: {
            vehicleModule: {
              $cond: {
                if: { $type: '$vehicleModule' },
                then: { $toObjectId: '$vehicleModule' },
                else: '$vehicleModule',
              },
            },
            driverModule: {
              $cond: {
                if: { $type: '$driverModule' },
                then: { $toObjectId: '$driverModule' },
                else: '$driverModule',
              },
            },
          },
        },
        // Join with Vehicle Module
        {
          $lookup: {
            from: 'vehicles',
            localField: 'vehicleModule',
            foreignField: '_id',
            as: 'vehicleInfo',
          },
        },
        {
          $unwind: {
            path: '$vehicleInfo',
            preserveNullAndEmptyArrays: true,
          },
        },
        // Join with Driver Module
        {
          $lookup: {
            from: 'drivers',
            localField: 'driverModule',
            foreignField: '_id',
            as: 'driverInfo',
          },
        },
        {
          $unwind: {
            path: '$driverInfo',
            preserveNullAndEmptyArrays: true,
          },
        },
      ]);

      if (!vehicleMaster || vehicleMaster.length === 0) {
        this.logger.warn(`Vehicle Master not found with ID: ${id}`);

        // 📝 Log not found
        await this.sendLog({
          method: 'GET',
          url: `/api/vehicle-masters/${id}`,
          statusCode: 404,
          operation: 'READ',
          resource: 'VEHICLE_MASTER',
          message: `Vehicle Master not found with ID: ${id}`,
          userId,
          metadata: { vehicleMasterId: id },
          responseTime: Date.now() - startTime,
        });

        throw new NotFoundException('Vehicle Master not found');
      }

      // 📝 Log successful find
      await this.sendLog({
        method: 'GET',
        url: `/api/vehicle-masters/${id}`,
        statusCode: 200,
        operation: 'READ',
        resource: 'VEHICLE_MASTER',
        message: 'Vehicle Master found successfully',
        userId,
        metadata: {
          vehicleMasterId: id,
          foundVehicleMasterId: vehicleMaster[0]._id,
          vehicleNumber: vehicleMaster[0].vehicleNumber,
          chassisNumber: vehicleMaster[0].chassisNumber,
          engineNumber: vehicleMaster[0].engineNumber,
        },
        responseTime: Date.now() - startTime,
      });

      this.logger.log(`Vehicle Master found with ID: ${id}`);
      return vehicleMaster[0];
    } catch (error) {
      // Re-throw NotFoundException (already logged above)
      if (error instanceof NotFoundException) {
        throw error;
      }

      // 📝 Log other errors
      await this.sendLog({
        method: 'GET',
        url: `/api/vehicle-masters/${id}`,
        statusCode: 500,
        operation: 'READ',
        resource: 'VEHICLE_MASTER',
        message: `Failed to find vehicle master: ${error.message}`,
        userId,
        metadata: { vehicleMasterId: id },
        responseTime: Date.now() - startTime,
        isError: true,
        errorMessage: error.message,
        stackTrace: error.stack,
      });

      this.logger.error(
        `Failed to find vehicle master: ${error.message}`,
        error.stack,
      );
      throw error;
    }
  }

  async update(
    id: string,
    updateVehicleMasterDto: UpdateVehicleMasterDto,
    userId?: string,
  ): Promise<any> {
    const startTime = Date.now();

    try {
      this.logger.log(`Updating vehicle master with ID: ${id}`);

      if (!Types.ObjectId.isValid(id)) {
        const errorMessage = 'Invalid Vehicle Master ID';

        // 📝 Log invalid ID error
        await this.sendLog({
          method: 'PUT',
          url: `/api/vehicle-masters/${id}`,
          statusCode: 400,
          operation: 'UPDATE',
          resource: 'VEHICLE_MASTER',
          message: 'Vehicle Master update failed - invalid ID format',
          userId,
          metadata: {
            vehicleMasterId: id,
            updateData: updateVehicleMasterDto,
          },
          responseTime: Date.now() - startTime,
          isError: true,
          errorMessage,
        });

        throw new NotFoundException(errorMessage);
      }

      // Check if updating unique fields and they don't conflict with other vehicle masters
      if (
        updateVehicleMasterDto.vehicleNumber ||
        updateVehicleMasterDto.chassisNumber ||
        updateVehicleMasterDto.engineNumber
      ) {
        const conflictConditions: any = [];

        if (updateVehicleMasterDto.vehicleNumber) {
          conflictConditions.push({
            vehicleNumber: updateVehicleMasterDto.vehicleNumber,
          });
        }
        if (updateVehicleMasterDto.chassisNumber) {
          conflictConditions.push({
            chassisNumber: updateVehicleMasterDto.chassisNumber,
          });
        }
        if (updateVehicleMasterDto.engineNumber) {
          conflictConditions.push({
            engineNumber: updateVehicleMasterDto.engineNumber,
          });
        }

        const existingVehicleMaster = await this.vehicleMasterModel.findOne({
          _id: { $ne: id },
          $or: conflictConditions,
        });

        if (existingVehicleMaster) {
          const errorMessage =
            'Vehicle Master with this vehicle number, chassis number, or engine number already exists';

          // Determine which field caused the conflict
          let conflictField = '';
          let conflictValue = '';
          if (
            updateVehicleMasterDto.vehicleNumber &&
            existingVehicleMaster.vehicleNumber ===
              updateVehicleMasterDto.vehicleNumber
          ) {
            conflictField = 'vehicleNumber';
            conflictValue = updateVehicleMasterDto.vehicleNumber;
          } else if (
            updateVehicleMasterDto.chassisNumber &&
            existingVehicleMaster.chassisNumber ===
              updateVehicleMasterDto.chassisNumber
          ) {
            conflictField = 'chassisNumber';
            conflictValue = updateVehicleMasterDto.chassisNumber;
          } else if (
            updateVehicleMasterDto.engineNumber &&
            existingVehicleMaster.engineNumber ===
              updateVehicleMasterDto.engineNumber
          ) {
            conflictField = 'engineNumber';
            conflictValue = updateVehicleMasterDto.engineNumber;
          }

          // 📝 Log conflict error
          await this.sendLog({
            method: 'PUT',
            url: `/api/vehicle-masters/${id}`,
            statusCode: 409,
            operation: 'UPDATE',
            resource: 'VEHICLE_MASTER',
            message: 'Vehicle Master update failed - duplicate field',
            userId,
            metadata: {
              vehicleMasterId: id,
              updateData: updateVehicleMasterDto,
              conflictField,
              conflictValue,
              errorType: 'DUPLICATE_FIELD',
            },
            responseTime: Date.now() - startTime,
            isError: true,
            errorMessage,
          });

          throw new ConflictException(errorMessage);
        }
      }

      // Validate vehicle module if provided
      if (updateVehicleMasterDto.vehicleModule) {
        const vehicle = await this.vehicleModel.findById(
          updateVehicleMasterDto.vehicleModule,
        );
        if (!vehicle) {
          const errorMessage = 'Vehicle Module not found';

          // 📝 Log vehicle not found error
          await this.sendLog({
            method: 'PUT',
            url: `/api/vehicle-masters/${id}`,
            statusCode: 404,
            operation: 'UPDATE',
            resource: 'VEHICLE_MASTER',
            message: 'Vehicle Master update failed - vehicle module not found',
            userId,
            metadata: {
              vehicleMasterId: id,
              updateData: updateVehicleMasterDto,
              vehicleModuleId: updateVehicleMasterDto.vehicleModule,
              errorType: 'VEHICLE_NOT_FOUND',
            },
            responseTime: Date.now() - startTime,
            isError: true,
            errorMessage,
          });

          throw new NotFoundException(errorMessage);
        }
      }

      // Validate driver module if provided
      if (updateVehicleMasterDto.driverModule) {
        const driver = await this.driverModel.findById(
          updateVehicleMasterDto.driverModule,
        );
        if (!driver) {
          const errorMessage = 'Driver Module not found';

          // 📝 Log driver not found error
          await this.sendLog({
            method: 'PUT',
            url: `/api/vehicle-masters/${id}`,
            statusCode: 404,
            operation: 'UPDATE',
            resource: 'VEHICLE_MASTER',
            message: 'Vehicle Master update failed - driver module not found',
            userId,
            metadata: {
              vehicleMasterId: id,
              updateData: updateVehicleMasterDto,
              driverModuleId: updateVehicleMasterDto.driverModule,
              errorType: 'DRIVER_NOT_FOUND',
            },
            responseTime: Date.now() - startTime,
            isError: true,
            errorMessage,
          });

          throw new NotFoundException(errorMessage);
        }
      }

      const vehicleMaster = await this.vehicleMasterModel.findByIdAndUpdate(
        id,
        updateVehicleMasterDto,
        { new: true },
      );

      if (!vehicleMaster) {
        this.logger.warn(`Vehicle Master not found for update with ID: ${id}`);

        // 📝 Log not found
        await this.sendLog({
          method: 'PUT',
          url: `/api/vehicle-masters/${id}`,
          statusCode: 404,
          operation: 'UPDATE',
          resource: 'VEHICLE_MASTER',
          message: `Vehicle Master not found for update with ID: ${id}`,
          userId,
          metadata: {
            vehicleMasterId: id,
            updateData: updateVehicleMasterDto,
          },
          responseTime: Date.now() - startTime,
        });

        throw new NotFoundException('Vehicle Master not found');
      }

      const updatedVehicleMaster = await this.findOne(id); // Return with populated data

      // 📝 Log successful update
      await this.sendLog({
        method: 'PUT',
        url: `/api/vehicle-masters/${id}`,
        statusCode: 200,
        operation: 'UPDATE',
        resource: 'VEHICLE_MASTER',
        message: `Vehicle Master updated successfully: ${vehicleMaster.vehicleNumber}`,
        userId,
        metadata: {
          vehicleMasterId: id,
          updatedVehicleMasterId: vehicleMaster._id,
          vehicleNumber: vehicleMaster.vehicleNumber,
          chassisNumber: vehicleMaster.chassisNumber,
          engineNumber: vehicleMaster.engineNumber,
          updateData: updateVehicleMasterDto,
        },
        responseTime: Date.now() - startTime,
      });

      this.logger.log(`Vehicle Master updated successfully with ID: ${id}`);
      return updatedVehicleMaster;
    } catch (error) {
      // Re-throw known exceptions (already logged above)
      if (
        error instanceof NotFoundException ||
        error instanceof ConflictException
      ) {
        throw error;
      }

      // 📝 Log other errors
      await this.sendLog({
        method: 'PUT',
        url: `/api/vehicle-masters/${id}`,
        statusCode: 500,
        operation: 'UPDATE',
        resource: 'VEHICLE_MASTER',
        message: `Vehicle Master update failed: ${error.message}`,
        userId,
        metadata: {
          vehicleMasterId: id,
          updateData: updateVehicleMasterDto,
        },
        responseTime: Date.now() - startTime,
        isError: true,
        errorMessage: error.message,
        stackTrace: error.stack,
      });

      this.logger.error(
        `Failed to update vehicle master: ${error.message}`,
        error.stack,
      );
      throw error;
    }
  }

  async remove(id: string, userId?: string): Promise<void> {
    const startTime = Date.now();

    try {
      this.logger.log(`Deleting vehicle master with ID: ${id}`);

      if (!Types.ObjectId.isValid(id)) {
        const errorMessage = 'Invalid Vehicle Master ID';

        // 📝 Log invalid ID error
        await this.sendLog({
          method: 'DELETE',
          url: `/api/vehicle-masters/${id}`,
          statusCode: 400,
          operation: 'DELETE',
          resource: 'VEHICLE_MASTER',
          message: 'Vehicle Master deletion failed - invalid ID format',
          userId,
          metadata: { vehicleMasterId: id },
          responseTime: Date.now() - startTime,
          isError: true,
          errorMessage,
        });

        throw new NotFoundException(errorMessage);
      }

      const result = await this.vehicleMasterModel.findByIdAndDelete(id);
      if (!result) {
        this.logger.warn(
          `Vehicle Master not found for deletion with ID: ${id}`,
        );

        // 📝 Log not found
        await this.sendLog({
          method: 'DELETE',
          url: `/api/vehicle-masters/${id}`,
          statusCode: 404,
          operation: 'DELETE',
          resource: 'VEHICLE_MASTER',
          message: `Vehicle Master not found for deletion with ID: ${id}`,
          userId,
          metadata: { vehicleMasterId: id },
          responseTime: Date.now() - startTime,
        });

        throw new NotFoundException('Vehicle Master not found');
      }

      // 📝 Log successful deletion
      await this.sendLog({
        method: 'DELETE',
        url: `/api/vehicle-masters/${id}`,
        statusCode: 200,
        operation: 'DELETE',
        resource: 'VEHICLE_MASTER',
        message: `Vehicle Master deleted successfully: ${result.vehicleNumber}`,
        userId,
        metadata: {
          vehicleMasterId: id,
          deletedVehicleMasterId: result._id,
          vehicleNumber: result.vehicleNumber,
          chassisNumber: result.chassisNumber,
          engineNumber: result.engineNumber,
        },
        responseTime: Date.now() - startTime,
      });

      this.logger.log(`Vehicle Master deleted successfully with ID: ${id}`);
    } catch (error) {
      // Re-throw NotFoundException (already logged above)
      if (error instanceof NotFoundException) {
        throw error;
      }

      // 📝 Log other errors
      await this.sendLog({
        method: 'DELETE',
        url: `/api/vehicle-masters/${id}`,
        statusCode: 500,
        operation: 'DELETE',
        resource: 'VEHICLE_MASTER',
        message: `Vehicle Master deletion failed: ${error.message}`,
        userId,
        metadata: { vehicleMasterId: id },
        responseTime: Date.now() - startTime,
        isError: true,
        errorMessage: error.message,
        stackTrace: error.stack,
      });

      this.logger.error(
        `Failed to delete vehicle master: ${error.message}`,
        error.stack,
      );
      throw error;
    }
  }

  async findAllForExport(userId?: string): Promise<any[]> {
    const startTime = Date.now();

    try {
      this.logger.log('Retrieving all vehicle masters for export');

      // Get all vehicle masters with vehicle and driver info
      const vehicleMasters = await this.vehicleMasterModel.aggregate([
        // Convert string IDs to ObjectIds if needed
        {
          $addFields: {
            vehicleModule: {
              $cond: {
                if: { $type: '$vehicleModule' },
                then: { $toObjectId: '$vehicleModule' },
                else: '$vehicleModule',
              },
            },
            driverModule: {
              $cond: {
                if: { $type: '$driverModule' },
                then: { $toObjectId: '$driverModule' },
                else: '$driverModule',
              },
            },
          },
        },
        // Join with Vehicle Module
        {
          $lookup: {
            from: 'vehicles',
            localField: 'vehicleModule',
            foreignField: '_id',
            as: 'vehicleInfo',
          },
        },
        {
          $unwind: {
            path: '$vehicleInfo',
            preserveNullAndEmptyArrays: true,
          },
        },
        // Join with Driver Module
        {
          $lookup: {
            from: 'drivers',
            localField: 'driverModule',
            foreignField: '_id',
            as: 'driverInfo',
          },
        },
        {
          $unwind: {
            path: '$driverInfo',
            preserveNullAndEmptyArrays: true,
          },
        },
        { $sort: { createdAt: -1 } },
      ]);

      // 📝 Log successful retrieval
      await this.sendLog({
        method: 'GET',
        url: '/api/vehicle-masters/all',
        statusCode: 200,
        operation: 'READ',
        resource: 'VEHICLE_MASTER',
        message: `Retrieved all ${vehicleMasters.length} vehicle masters for export`,
        userId,
        metadata: { totalCount: vehicleMasters.length },
        responseTime: Date.now() - startTime,
      });

      this.logger.log(`Retrieved all ${vehicleMasters.length} vehicle masters`);
      return vehicleMasters;
    } catch (error) {
      // 📝 Log error
      await this.sendLog({
        method: 'GET',
        url: '/api/vehicle-masters/all',
        statusCode: 500,
        operation: 'READ',
        resource: 'VEHICLE_MASTER',
        message: `Failed to retrieve all vehicle masters: ${error.message}`,
        userId,
        responseTime: Date.now() - startTime,
        isError: true,
        errorMessage: error.message,
        stackTrace: error.stack,
      });

      this.logger.error(
        `Failed to retrieve all vehicle masters: ${error.message}`,
        error.stack,
      );
      throw error;
    }
  }

  exportToPDF(vehicleMasters: any[], res: Response, userId?: string): void {
    const startTime = Date.now();

    try {
      this.logger.log(
        `Starting PDF export for ${vehicleMasters.length} vehicle masters`,
      );

      // Create a document with margins
      const doc = new PDFDocument({ margin: 30 });

      // Set response headers for PDF download
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader(
        'Content-Disposition',
        'attachment; filename=vehicle_masters.pdf',
      );

      doc.pipe(res);

      // Title
      doc
        .fontSize(18)
        .text('Vehicle Master List', { align: 'center' })
        .moveDown(1);

      // Define table structure
      const table = {
        headers: [
          { label: 'Vehicle No.', width: 80 },
          { label: 'Chassis No.', width: 100 },
          { label: 'Engine No.', width: 100 },
          { label: 'Vehicle', width: 100 },
          { label: 'Driver', width: 120 },
          { label: 'Status', width: 70 },
        ],
        rows: vehicleMasters.map((vm) => [
          vm.vehicleNumber || '',
          vm.chassisNumber || '',
          vm.engineNumber || '',
          vm.vehicleInfo
            ? `${vm.vehicleInfo.brand} ${vm.vehicleInfo.model}`
            : 'N/A',
          vm.driverInfo
            ? `${vm.driverInfo.name} (${vm.driverInfo.licenseNumber})`
            : 'N/A',
          vm.status || 'Active',
        ]),
        rowHeight: 25,
        margin: { top: 40 },
      };

      // Table drawing position
      const startY = doc.y + table.margin.top;
      let currentY = startY;

      // Draw table headers
      doc.font('Helvetica-Bold').fontSize(10);
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
      doc.font('Helvetica').fontSize(9);

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

      // Add footer with date
      doc
        .fontSize(8)
        .text(
          `Generated on: ${new Date().toLocaleDateString()}`,
          doc.page.margins.left,
          doc.page.height - 50,
          { align: 'right' },
        );

      doc.end();

      // 📝 Log export success
      this.sendLog({
        method: 'GET',
        url: '/api/vehicle-masters/export/pdf',
        statusCode: 200,
        operation: 'EXPORT',
        resource: 'VEHICLE_MASTER',
        message: 'PDF export completed successfully',
        userId,
        metadata: {
          exportFormat: 'PDF',
          vehicleMasterCount: vehicleMasters.length,
        },
        responseTime: Date.now() - startTime,
      });

      this.logger.log(
        `PDF export completed for ${vehicleMasters.length} vehicle masters`,
      );
    } catch (error) {
      console.error('Error exporting to PDF:', error);

      // 📝 Log export error
      this.sendLog({
        method: 'GET',
        url: '/api/vehicle-masters/export/pdf',
        statusCode: 500,
        operation: 'EXPORT',
        resource: 'VEHICLE_MASTER',
        message: `PDF export failed: ${error.message}`,
        userId,
        metadata: {
          exportFormat: 'PDF',
          vehicleMasterCount: vehicleMasters.length,
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

  exportToCSV(vehicleMasters: any[], res: Response, userId?: string): void {
    const startTime = Date.now();

    try {
      this.logger.log(
        `Starting CSV export for ${vehicleMasters.length} vehicle masters`,
      );

      // Set response headers
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader(
        'Content-Disposition',
        'attachment; filename=vehicle_masters_' +
          new Date().toISOString().slice(0, 10) +
          '.csv',
      );

      // CSV configuration
      const csvStream = format({
        headers: [
          'Vehicle Number',
          'Chassis Number',
          'Engine Number',
          'Vehicle Brand',
          'Vehicle Model',
          'Driver Name',
          'Driver License',
          'Status',
          'Created Date',
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
      vehicleMasters.forEach((vm) => {
        csvStream.write({
          'Vehicle Number': vm.vehicleNumber || 'N/A',
          'Chassis Number': vm.chassisNumber || 'N/A',
          'Engine Number': vm.engineNumber || 'N/A',
          'Vehicle Brand': vm.vehicleInfo?.brand || 'N/A',
          'Vehicle Model': vm.vehicleInfo?.model || 'N/A',
          'Driver Name': vm.driverInfo?.name || 'N/A',
          'Driver License': vm.driverInfo?.licenseNumber || 'N/A',
          Status: vm.status || 'Active',
          'Created Date': vm.createdAt
            ? new Date(vm.createdAt).toLocaleDateString()
            : 'N/A',
        });
      });

      // Handle stream events
      csvStream.on('error', (error) => {
        console.error('CSV stream error:', error);
        // 📝 Log CSV error
        this.sendLog({
          method: 'GET',
          url: '/api/vehicle-masters/export/csv',
          statusCode: 500,
          operation: 'EXPORT',
          resource: 'VEHICLE_MASTER',
          message: `CSV export failed: ${error.message}`,
          userId,
          metadata: {
            exportFormat: 'CSV',
            vehicleMasterCount: vehicleMasters.length,
          },
          responseTime: Date.now() - startTime,
          isError: true,
          errorMessage: error.message,
        });

        if (!res.headersSent) {
          res.status(500).send('Error generating CSV');
        }
      });

      csvStream.on('end', () => {
        console.log('CSV export completed successfully');
        // 📝 Log export success
        this.sendLog({
          method: 'GET',
          url: '/api/vehicle-masters/export/csv',
          statusCode: 200,
          operation: 'EXPORT',
          resource: 'VEHICLE_MASTER',
          message: 'CSV export completed successfully',
          userId,
          metadata: {
            exportFormat: 'CSV',
            vehicleMasterCount: vehicleMasters.length,
          },
          responseTime: Date.now() - startTime,
        });
      });

      csvStream.end();
    } catch (error) {
      console.error('Error in exportToCSV:', error);
      // 📝 Log export error
      this.sendLog({
        method: 'GET',
        url: '/api/vehicle-masters/export/csv',
        statusCode: 500,
        operation: 'EXPORT',
        resource: 'VEHICLE_MASTER',
        message: `CSV export failed: ${error.message}`,
        userId,
        metadata: {
          exportFormat: 'CSV',
          vehicleMasterCount: vehicleMasters.length,
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
    vehicleMasters: any[],
    res: Response,
    userId?: string,
  ): Promise<void> {
    const startTime = Date.now();

    try {
      this.logger.log(
        `Starting XLSX export for ${vehicleMasters.length} vehicle masters`,
      );

      const workbook = new ExcelJS.Workbook();
      workbook.creator = 'Vehicle Management System';
      workbook.created = new Date();

      const worksheet = workbook.addWorksheet('Vehicle Masters', {
        pageSetup: {
          orientation: 'landscape',
          fitToPage: true,
          fitToWidth: 1,
        },
      });

      // Define columns with specific widths and styles
      worksheet.columns = [
        {
          header: 'Vehicle Number',
          key: 'vehicleNumber',
          width: 15,
          style: { numFmt: '@' },
        },
        {
          header: 'Chassis Number',
          key: 'chassisNumber',
          width: 20,
          style: { numFmt: '@' },
        },
        {
          header: 'Engine Number',
          key: 'engineNumber',
          width: 20,
          style: { numFmt: '@' },
        },
        {
          header: 'Vehicle Brand',
          key: 'vehicleBrand',
          width: 15,
        },
        {
          header: 'Vehicle Model',
          key: 'vehicleModel',
          width: 15,
        },
        {
          header: 'Driver Name',
          key: 'driverName',
          width: 20,
        },
        {
          header: 'Driver License',
          key: 'driverLicense',
          width: 15,
        },
        {
          header: 'Status',
          key: 'status',
          width: 10,
        },
        {
          header: 'Created At',
          key: 'createdAt',
          width: 20,
          style: { numFmt: 'yyyy-mm-dd hh:mm:ss' },
        },
        {
          header: 'Updated At',
          key: 'updatedAt',
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
      vehicleMasters.forEach((vm) => {
        const row = worksheet.addRow({
          vehicleNumber: vm.vehicleNumber || 'N/A',
          chassisNumber: vm.chassisNumber || 'N/A',
          engineNumber: vm.engineNumber || 'N/A',
          vehicleBrand: vm.vehicleInfo?.brand || 'N/A',
          vehicleModel: vm.vehicleInfo?.model || 'N/A',
          driverName: vm.driverInfo?.name || 'N/A',
          driverLicense: vm.driverInfo?.licenseNumber || 'N/A',
          status: vm.status || 'Active',
          createdAt: vm.createdAt,
          updatedAt: vm.updatedAt,
        });

        // Style the data rows
        row.eachCell((cell) => {
          cell.border = {
            top: { style: 'thin' },
            left: { style: 'thin' },
            bottom: { style: 'thin' },
            right: { style: 'thin' },
          };

          // Highlight active vehicles
          if (cell.value === 'Active') {
            cell.fill = {
              type: 'pattern',
              pattern: 'solid',
              fgColor: { argb: 'FFC6EFCE' }, // Light green
            };
            cell.font = {
              bold: true,
              color: { argb: 'FF006100' }, // Dark green
            };
          }

          // Highlight inactive vehicles
          if (cell.value === 'Inactive') {
            cell.fill = {
              type: 'pattern',
              pattern: 'solid',
              fgColor: { argb: 'FFFFC7CE' }, // Light red
            };
            cell.font = {
              bold: true,
              color: { argb: 'FF9C0006' }, // Dark red
            };
          }
        });
      });

      // Add summary row
      const summaryRow = worksheet.addRow({
        vehicleNumber: 'Total Records:',
        chassisNumber: vehicleMasters.length.toString(),
      });
      summaryRow.font = { bold: true };
      summaryRow.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFE7E6E6' }, // Light gray
      };

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
        `attachment; filename=vehicle_masters_${new Date().toISOString().slice(0, 10)}.xlsx`,
      );

      await workbook.xlsx.write(res);
      res.end();

      // 📝 Log export success
      await this.sendLog({
        method: 'GET',
        url: '/api/vehicle-masters/export/xlsx',
        statusCode: 200,
        operation: 'EXPORT',
        resource: 'VEHICLE_MASTER',
        message: 'XLSX export completed successfully',
        userId,
        metadata: {
          exportFormat: 'XLSX',
          vehicleMasterCount: vehicleMasters.length,
        },
        responseTime: Date.now() - startTime,
      });

      this.logger.log(
        `XLSX export completed for ${vehicleMasters.length} vehicle masters`,
      );
    } catch (error) {
      console.error('Error exporting to XLSX:', error);

      // 📝 Log export error
      await this.sendLog({
        method: 'GET',
        url: '/api/vehicle-masters/export/xlsx',
        statusCode: 500,
        operation: 'EXPORT',
        resource: 'VEHICLE_MASTER',
        message: `XLSX export failed: ${error.message}`,
        userId,
        metadata: {
          exportFormat: 'XLSX',
          vehicleMasterCount: vehicleMasters.length,
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

  /**
   * Send log to logs microservice using axios
   */
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
          userAgent: 'vehicle-master-service',
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
}
