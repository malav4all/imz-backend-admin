import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Driver, DriverDocument } from './schema/driver.schema';
import {
  CreateDriverDto,
  SearchDriverDto,
  UpdateDriverDto,
} from './dto/create-driver.dto';
import { PaginatedResponse } from 'src/comman/pagination.dto';
import * as PDFDocument from 'pdfkit';
import * as ExcelJS from 'exceljs';
import { format } from '@fast-csv/format';
import { Response } from 'express';
import axios from 'axios';

@Injectable()
export class DriverService {
  private readonly logger = new Logger(DriverService.name);
  private readonly logsServiceUrl =
    process.env.LOGS_SERVICE_URL || 'http://localhost:9008/logs';

  constructor(
    @InjectModel(Driver.name) private driverModel: Model<DriverDocument>,
  ) {}

  async create(
    createDriverDto: CreateDriverDto,
    userId?: string,
  ): Promise<Driver> {
    const startTime = Date.now();

    try {
      this.logger.log(`Creating driver: ${createDriverDto.name}`);

      // Check for existing license number
      const existingLicense = await this.driverModel.findOne({
        licenseNo: createDriverDto.licenseNo,
      });
      if (existingLicense) {
        const errorMessage = 'Driver with this license number already exists';

        // 📝 Log license conflict error (only error log)
        await this.sendLog({
          method: 'POST',
          url: '/api/drivers',
          statusCode: 409,
          operation: 'CREATE',
          resource: 'DRIVER',
          message: 'Driver creation failed - license number conflict',
          userId,
          metadata: {
            requestData: createDriverDto,
            conflictField: 'licenseNo',
            conflictValue: createDriverDto.licenseNo,
            errorType: 'DUPLICATE_LICENSE',
          },
          responseTime: Date.now() - startTime,
          isError: true,
          errorMessage,
        });

        throw new ConflictException(errorMessage);
      }

      // Check for existing Aadhaar number
      const existingAadhar = await this.driverModel.findOne({
        adharNo: createDriverDto.adharNo,
      });
      if (existingAadhar) {
        const errorMessage = 'Driver with this Aadhaar number already exists';

        // 📝 Log Aadhaar conflict error (only error log)
        await this.sendLog({
          method: 'POST',
          url: '/api/drivers',
          statusCode: 409,
          operation: 'CREATE',
          resource: 'DRIVER',
          message: 'Driver creation failed - Aadhaar number conflict',
          userId,
          metadata: {
            requestData: createDriverDto,
            conflictField: 'adharNo',
            conflictValue: createDriverDto.adharNo,
            errorType: 'DUPLICATE_AADHAAR',
          },
          responseTime: Date.now() - startTime,
          isError: true,
          errorMessage,
        });

        throw new ConflictException(errorMessage);
      }

      // Check for existing email
      const existingEmail = await this.driverModel.findOne({
        email: createDriverDto.email,
      });
      if (existingEmail) {
        const errorMessage = 'Driver with this email already exists';

        // 📝 Log email conflict error (only error log)
        await this.sendLog({
          method: 'POST',
          url: '/api/drivers',
          statusCode: 409,
          operation: 'CREATE',
          resource: 'DRIVER',
          message: 'Driver creation failed - email conflict',
          userId,
          metadata: {
            requestData: createDriverDto,
            conflictField: 'email',
            conflictValue: createDriverDto.email,
            errorType: 'DUPLICATE_EMAIL',
          },
          responseTime: Date.now() - startTime,
          isError: true,
          errorMessage,
        });

        throw new ConflictException(errorMessage);
      }

      const driver = new this.driverModel(createDriverDto);
      const savedDriver = await driver.save();

      // 📝 Log successful creation (only success log)
      await this.sendLog({
        method: 'POST',
        url: '/api/drivers',
        statusCode: 201,
        operation: 'CREATE',
        resource: 'DRIVER',
        message: `Driver created successfully: ${savedDriver.name}`,
        userId,
        metadata: {
          driverId: savedDriver._id,
          name: savedDriver.name,
          email: savedDriver.email,
          licenseNo: savedDriver.licenseNo,
          contactNo: savedDriver.contactNo,
          requestData: createDriverDto,
        },
        responseTime: Date.now() - startTime,
      });

      this.logger.log(
        `Driver created successfully with ID: ${savedDriver._id}`,
      );
      return savedDriver;
    } catch (error) {
      // Handle MongoDB duplicate key errors
      if (error.code === 11000) {
        const field = Object.keys(error.keyPattern)[0];
        const errorMessage = `Driver with this ${field} already exists`;

        // 📝 Log duplicate key error (only error log)
        await this.sendLog({
          method: 'POST',
          url: '/api/drivers',
          statusCode: 409,
          operation: 'CREATE',
          resource: 'DRIVER',
          message: `Driver creation failed - duplicate ${field}`,
          userId,
          metadata: {
            requestData: createDriverDto,
            conflictField: field,
            errorType: 'DUPLICATE_KEY_ERROR',
          },
          responseTime: Date.now() - startTime,
          isError: true,
          errorMessage,
        });

        throw new ConflictException(errorMessage);
      }

      // Re-throw ConflictException (already logged above)
      if (error instanceof ConflictException) {
        throw error;
      }

      // 📝 Log other errors (only error log)
      await this.sendLog({
        method: 'POST',
        url: '/api/drivers',
        statusCode: 500,
        operation: 'CREATE',
        resource: 'DRIVER',
        message: `Driver creation failed: ${error.message}`,
        userId,
        metadata: {
          requestData: createDriverDto,
          errorType: error.name,
        },
        responseTime: Date.now() - startTime,
        isError: true,
        errorMessage: error.message,
        stackTrace: error.stack,
      });

      this.logger.error(
        `Failed to create driver: ${error.message}`,
        error.stack,
      );
      throw error;
    }
  }

  async findAll(
    searchDto: SearchDriverDto,
    userId?: string,
  ): Promise<PaginatedResponse<Driver>> {
    const startTime = Date.now();

    try {
      this.logger.log(
        `Retrieving drivers - Page: ${searchDto.page}, Limit: ${searchDto.limit}, Search: "${searchDto.searchText}"`,
      );

      const { searchText, page = 1, limit = 10 } = searchDto;
      const skip = (page - 1) * limit;

      let query = {};

      // Build search query
      if (searchText && searchText.trim()) {
        const searchRegex = new RegExp(searchText.trim(), 'i');
        query = {
          $or: [
            { name: searchRegex },
            { email: searchRegex },
            { contactNo: searchRegex },
            { licenseNo: searchRegex },
            { adharNo: searchRegex },
          ],
        };
      }

      // Execute query with pagination
      const [drivers, total] = await Promise.all([
        this.driverModel
          .find(query)
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(limit)
          .lean()
          .exec(),
        this.driverModel.countDocuments(query),
      ]);

      const result = new PaginatedResponse(drivers, page, limit, total);

      // 📝 Log successful retrieval (only success log)
      await this.sendLog({
        method: 'GET',
        url: '/api/drivers',
        statusCode: 200,
        operation: searchText ? 'SEARCH' : 'READ',
        resource: 'DRIVER',
        message: searchText
          ? `Driver search completed - found ${drivers.length} drivers`
          : `Successfully retrieved ${drivers.length} drivers`,
        userId,
        metadata: {
          searchText: searchText || '',
          page,
          limit,
          retrievedCount: drivers.length,
          totalCount: total,
          hasSearch: !!searchText,
        },
        responseTime: Date.now() - startTime,
      });

      this.logger.log(
        `Retrieved ${drivers.length} drivers out of ${total} total`,
      );
      return result;
    } catch (error) {
      // 📝 Log error (only error log)
      await this.sendLog({
        method: 'GET',
        url: '/api/drivers',
        statusCode: 500,
        operation: searchDto.searchText ? 'SEARCH' : 'READ',
        resource: 'DRIVER',
        message: `Failed to retrieve drivers: ${error.message}`,
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
        `Failed to retrieve drivers: ${error.message}`,
        error.stack,
      );
      throw error;
    }
  }

  async findOne(id: string, userId?: string): Promise<Driver> {
    const startTime = Date.now();

    try {
      this.logger.log(`Finding driver with ID: ${id}`);

      if (!id.match(/^[0-9a-fA-F]{24}$/)) {
        const errorMessage = 'Invalid driver ID format';

        // 📝 Log invalid ID error (only error log)
        await this.sendLog({
          method: 'GET',
          url: `/api/drivers/${id}`,
          statusCode: 400,
          operation: 'READ',
          resource: 'DRIVER',
          message: 'Driver lookup failed - invalid ID format',
          userId,
          metadata: { driverId: id },
          responseTime: Date.now() - startTime,
          isError: true,
          errorMessage,
        });

        throw new BadRequestException(errorMessage);
      }

      const driver = await this.driverModel.findById(id).lean().exec();

      if (!driver) {
        this.logger.warn(`Driver not found with ID: ${id}`);

        // 📝 Log not found (only not found log)
        await this.sendLog({
          method: 'GET',
          url: `/api/drivers/${id}`,
          statusCode: 404,
          operation: 'READ',
          resource: 'DRIVER',
          message: `Driver not found with ID: ${id}`,
          userId,
          metadata: { driverId: id },
          responseTime: Date.now() - startTime,
        });

        throw new NotFoundException('Driver not found');
      }

      // 📝 Log successful find (only success log)
      await this.sendLog({
        method: 'GET',
        url: `/api/drivers/${id}`,
        statusCode: 200,
        operation: 'READ',
        resource: 'DRIVER',
        message: `Driver found successfully`,
        userId,
        metadata: {
          driverId: id,
          foundDriverId: driver._id,
          name: driver.name,
          email: driver.email,
          licenseNo: driver.licenseNo,
        },
        responseTime: Date.now() - startTime,
      });

      this.logger.log(`Driver found with ID: ${id}`);
      return driver;
    } catch (error) {
      // Re-throw BadRequestException and NotFoundException (already logged above)
      if (
        error instanceof BadRequestException ||
        error instanceof NotFoundException
      ) {
        throw error;
      }

      // 📝 Log other errors (only error log)
      await this.sendLog({
        method: 'GET',
        url: `/api/drivers/${id}`,
        statusCode: 500,
        operation: 'READ',
        resource: 'DRIVER',
        message: `Failed to find driver: ${error.message}`,
        userId,
        metadata: { driverId: id },
        responseTime: Date.now() - startTime,
        isError: true,
        errorMessage: error.message,
        stackTrace: error.stack,
      });

      this.logger.error(`Failed to find driver: ${error.message}`, error.stack);
      throw error;
    }
  }

  async update(
    id: string,
    updateDriverDto: UpdateDriverDto,
    userId?: string,
  ): Promise<any> {
    const startTime = Date.now();

    try {
      this.logger.log(`Updating driver with ID: ${id}`);

      if (!id.match(/^[0-9a-fA-F]{24}$/)) {
        const errorMessage = 'Invalid driver ID format';

        // 📝 Log invalid ID error (only error log)
        await this.sendLog({
          method: 'PUT',
          url: `/api/drivers/${id}`,
          statusCode: 400,
          operation: 'UPDATE',
          resource: 'DRIVER',
          message: 'Driver update failed - invalid ID format',
          userId,
          metadata: {
            driverId: id,
            updateData: updateDriverDto,
          },
          responseTime: Date.now() - startTime,
          isError: true,
          errorMessage,
        });

        throw new BadRequestException(errorMessage);
      }

      // Check if driver exists
      const existingDriver = await this.driverModel.findById(id);
      if (!existingDriver) {
        this.logger.warn(`Driver not found for update with ID: ${id}`);

        // 📝 Log not found (only not found log)
        await this.sendLog({
          method: 'PUT',
          url: `/api/drivers/${id}`,
          statusCode: 404,
          operation: 'UPDATE',
          resource: 'DRIVER',
          message: `Driver not found for update with ID: ${id}`,
          userId,
          metadata: {
            driverId: id,
            updateData: updateDriverDto,
          },
          responseTime: Date.now() - startTime,
        });

        throw new NotFoundException('Driver not found');
      }

      // Check for conflicts with other drivers
      if (
        updateDriverDto.licenseNo &&
        updateDriverDto.licenseNo !== existingDriver.licenseNo
      ) {
        const conflictLicense = await this.driverModel.findOne({
          licenseNo: updateDriverDto.licenseNo,
          _id: { $ne: id },
        });
        if (conflictLicense) {
          const errorMessage =
            'Another driver with this license number already exists';

          // 📝 Log license conflict error (only error log)
          await this.sendLog({
            method: 'PUT',
            url: `/api/drivers/${id}`,
            statusCode: 409,
            operation: 'UPDATE',
            resource: 'DRIVER',
            message: 'Driver update failed - license number conflict',
            userId,
            metadata: {
              driverId: id,
              updateData: updateDriverDto,
              conflictField: 'licenseNo',
              conflictValue: updateDriverDto.licenseNo,
              errorType: 'DUPLICATE_LICENSE',
            },
            responseTime: Date.now() - startTime,
            isError: true,
            errorMessage,
          });

          throw new ConflictException(errorMessage);
        }
      }

      if (
        updateDriverDto.adharNo &&
        updateDriverDto.adharNo !== existingDriver.adharNo
      ) {
        const conflictAadhar = await this.driverModel.findOne({
          adharNo: updateDriverDto.adharNo,
          _id: { $ne: id },
        });
        if (conflictAadhar) {
          const errorMessage =
            'Another driver with this Aadhaar number already exists';

          // 📝 Log Aadhaar conflict error (only error log)
          await this.sendLog({
            method: 'PUT',
            url: `/api/drivers/${id}`,
            statusCode: 409,
            operation: 'UPDATE',
            resource: 'DRIVER',
            message: 'Driver update failed - Aadhaar number conflict',
            userId,
            metadata: {
              driverId: id,
              updateData: updateDriverDto,
              conflictField: 'adharNo',
              conflictValue: updateDriverDto.adharNo,
              errorType: 'DUPLICATE_AADHAAR',
            },
            responseTime: Date.now() - startTime,
            isError: true,
            errorMessage,
          });

          throw new ConflictException(errorMessage);
        }
      }

      if (
        updateDriverDto.email &&
        updateDriverDto.email !== existingDriver.email
      ) {
        const conflictEmail = await this.driverModel.findOne({
          email: updateDriverDto.email,
          _id: { $ne: id },
        });
        if (conflictEmail) {
          const errorMessage = 'Another driver with this email already exists';

          // 📝 Log email conflict error (only error log)
          await this.sendLog({
            method: 'PUT',
            url: `/api/drivers/${id}`,
            statusCode: 409,
            operation: 'UPDATE',
            resource: 'DRIVER',
            message: 'Driver update failed - email conflict',
            userId,
            metadata: {
              driverId: id,
              updateData: updateDriverDto,
              conflictField: 'email',
              conflictValue: updateDriverDto.email,
              errorType: 'DUPLICATE_EMAIL',
            },
            responseTime: Date.now() - startTime,
            isError: true,
            errorMessage,
          });

          throw new ConflictException(errorMessage);
        }
      }

      const updatedDriver: any = await this.driverModel
        .findByIdAndUpdate(id, updateDriverDto, {
          new: true,
          runValidators: true,
        })
        .lean()
        .exec();

      // 📝 Log successful update (only success log)
      await this.sendLog({
        method: 'PUT',
        url: `/api/drivers/${id}`,
        statusCode: 200,
        operation: 'UPDATE',
        resource: 'DRIVER',
        message: `Driver updated successfully: ${updatedDriver.name}`,
        userId,
        metadata: {
          driverId: id,
          updatedDriverId: updatedDriver._id,
          name: updatedDriver.name,
          email: updatedDriver.email,
          licenseNo: updatedDriver.licenseNo,
          updateData: updateDriverDto,
        },
        responseTime: Date.now() - startTime,
      });

      this.logger.log(`Driver updated successfully with ID: ${id}`);
      return updatedDriver;
    } catch (error) {
      // Handle MongoDB duplicate key errors
      if (error.code === 11000) {
        const field = Object.keys(error.keyPattern)[0];
        const errorMessage = `Another driver with this ${field} already exists`;

        // 📝 Log duplicate key error (only error log)
        await this.sendLog({
          method: 'PUT',
          url: `/api/drivers/${id}`,
          statusCode: 409,
          operation: 'UPDATE',
          resource: 'DRIVER',
          message: `Driver update failed - duplicate ${field}`,
          userId,
          metadata: {
            driverId: id,
            updateData: updateDriverDto,
            conflictField: field,
            errorType: 'DUPLICATE_KEY_ERROR',
          },
          responseTime: Date.now() - startTime,
          isError: true,
          errorMessage,
        });

        throw new ConflictException(errorMessage);
      }

      // Re-throw known exceptions (already logged above)
      if (
        error instanceof BadRequestException ||
        error instanceof NotFoundException ||
        error instanceof ConflictException
      ) {
        throw error;
      }

      // 📝 Log other errors (only error log)
      await this.sendLog({
        method: 'PUT',
        url: `/api/drivers/${id}`,
        statusCode: 500,
        operation: 'UPDATE',
        resource: 'DRIVER',
        message: `Driver update failed: ${error.message}`,
        userId,
        metadata: {
          driverId: id,
          updateData: updateDriverDto,
        },
        responseTime: Date.now() - startTime,
        isError: true,
        errorMessage: error.message,
        stackTrace: error.stack,
      });

      this.logger.error(
        `Failed to update driver: ${error.message}`,
        error.stack,
      );
      throw error;
    }
  }

  async remove(id: string, userId?: string): Promise<void> {
    const startTime = Date.now();

    try {
      this.logger.log(`Deleting driver with ID: ${id}`);

      if (!id.match(/^[0-9a-fA-F]{24}$/)) {
        const errorMessage = 'Invalid driver ID format';

        // 📝 Log invalid ID error (only error log)
        await this.sendLog({
          method: 'DELETE',
          url: `/api/drivers/${id}`,
          statusCode: 400,
          operation: 'DELETE',
          resource: 'DRIVER',
          message: 'Driver deletion failed - invalid ID format',
          userId,
          metadata: { driverId: id },
          responseTime: Date.now() - startTime,
          isError: true,
          errorMessage,
        });

        throw new BadRequestException(errorMessage);
      }

      const result = await this.driverModel.findByIdAndDelete(id).exec();

      if (!result) {
        this.logger.warn(`Driver not found for deletion with ID: ${id}`);

        // 📝 Log not found (only not found log)
        await this.sendLog({
          method: 'DELETE',
          url: `/api/drivers/${id}`,
          statusCode: 404,
          operation: 'DELETE',
          resource: 'DRIVER',
          message: `Driver not found for deletion with ID: ${id}`,
          userId,
          metadata: { driverId: id },
          responseTime: Date.now() - startTime,
        });

        throw new NotFoundException('Driver not found');
      }

      // 📝 Log successful deletion (only success log)
      await this.sendLog({
        method: 'DELETE',
        url: `/api/drivers/${id}`,
        statusCode: 200,
        operation: 'DELETE',
        resource: 'DRIVER',
        message: `Driver deleted successfully: ${result.name}`,
        userId,
        metadata: {
          driverId: id,
          deletedDriverId: result._id,
          name: result.name,
          email: result.email,
          licenseNo: result.licenseNo,
        },
        responseTime: Date.now() - startTime,
      });

      this.logger.log(`Driver deleted successfully with ID: ${id}`);
    } catch (error) {
      // Re-throw known exceptions (already logged above)
      if (
        error instanceof BadRequestException ||
        error instanceof NotFoundException
      ) {
        throw error;
      }

      // 📝 Log other errors (only error log)
      await this.sendLog({
        method: 'DELETE',
        url: `/api/drivers/${id}`,
        statusCode: 500,
        operation: 'DELETE',
        resource: 'DRIVER',
        message: `Driver deletion failed: ${error.message}`,
        userId,
        metadata: { driverId: id },
        responseTime: Date.now() - startTime,
        isError: true,
        errorMessage: error.message,
        stackTrace: error.stack,
      });

      this.logger.error(
        `Failed to delete driver: ${error.message}`,
        error.stack,
      );
      throw error;
    }
  }

  async findAllWithoutPagination(userId?: string): Promise<Driver[]> {
    const startTime = Date.now();

    try {
      this.logger.log('Retrieving all drivers without pagination');

      const drivers = await this.driverModel.find().lean().exec();

      // 📝 Log successful retrieval (only success log)
      await this.sendLog({
        method: 'GET',
        url: '/api/drivers/all',
        statusCode: 200,
        operation: 'READ',
        resource: 'DRIVER',
        message: `Retrieved all ${drivers.length} drivers`,
        userId,
        metadata: { totalCount: drivers.length },
        responseTime: Date.now() - startTime,
      });

      this.logger.log(`Retrieved all ${drivers.length} drivers`);
      return drivers;
    } catch (error) {
      // 📝 Log error (only error log)
      await this.sendLog({
        method: 'GET',
        url: '/api/drivers/all',
        statusCode: 500,
        operation: 'READ',
        resource: 'DRIVER',
        message: `Failed to retrieve all drivers: ${error.message}`,
        userId,
        responseTime: Date.now() - startTime,
        isError: true,
        errorMessage: error.message,
        stackTrace: error.stack,
      });

      this.logger.error(
        `Failed to retrieve all drivers: ${error.message}`,
        error.stack,
      );
      throw error;
    }
  }

  exportToPDF(drivers: Driver[], res: Response, userId?: string): void {
    const startTime = Date.now();

    try {
      this.logger.log(`Starting PDF export for ${drivers.length} drivers`);

      // Create a document with margins
      const doc = new PDFDocument({ margin: 30 });

      // Set response headers for PDF download
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', 'attachment; filename=drivers.pdf');

      doc.pipe(res);

      // Title
      doc.fontSize(18).text('Driver List', { align: 'center' }).moveDown(1);

      // Define table structure
      const table = {
        headers: [
          { label: 'Name', width: 120 },
          { label: 'Contact No', width: 100 },
          { label: 'Email', width: 150 },
          { label: 'License No', width: 120 },
          { label: 'Aadhaar No', width: 120 },
          { label: 'Status', width: 80 },
        ],
        rows: drivers.map((driver) => [
          driver.name || '',
          driver.contactNo || '',
          driver.email || '',
          driver.licenseNo || '',
          driver.adharNo || '',
          driver.isActive ? 'Active' : 'Inactive',
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
      doc.font('Helvetica').fontSize(10);

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

      // 📝 Log export success (only success log)
      this.sendLog({
        method: 'GET',
        url: '/api/drivers/export/pdf',
        statusCode: 200,
        operation: 'EXPORT',
        resource: 'DRIVER',
        message: `PDF export completed successfully`,
        userId,
        metadata: {
          exportFormat: 'PDF',
          driverCount: drivers.length,
        },
        responseTime: Date.now() - startTime,
      });

      this.logger.log(`PDF export completed for ${drivers.length} drivers`);
    } catch (error) {
      console.error('Error in exportToPDF:', error);

      // 📝 Log export error (only error log)
      this.sendLog({
        method: 'GET',
        url: '/api/drivers/export/pdf',
        statusCode: 500,
        operation: 'EXPORT',
        resource: 'DRIVER',
        message: `PDF export failed: ${error.message}`,
        userId,
        metadata: {
          exportFormat: 'PDF',
          driverCount: drivers.length,
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

  exportToCSV(drivers: Driver[], res: Response, userId?: string): void {
    const startTime = Date.now();

    try {
      this.logger.log(`Starting CSV export for ${drivers.length} drivers`);

      // Set response headers
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader(
        'Content-Disposition',
        'attachment; filename=drivers_' +
          new Date().toISOString().slice(0, 10) +
          '.csv',
      );

      // CSV configuration
      const csvStream = format({
        headers: [
          'Name',
          'Contact No',
          'Email',
          'License No',
          'Aadhaar No',
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
      drivers.forEach((driver) => {
        csvStream.write({
          Name: driver.name || 'N/A',
          'Contact No': driver.contactNo || 'N/A',
          Email: driver.email || 'N/A',
          'License No': driver.licenseNo || 'N/A',
          'Aadhaar No': driver.adharNo || 'N/A',
          Status: driver.isActive ? 'Active' : 'Inactive',
          // 'Created At': driver.createdAt
          //   ? new Date(driver.createdAt)
          //       .toISOString()
          //       .slice(0, 19)
          //       .replace('T', ' ')
          //   : 'N/A',
        });
      });

      // Handle stream events
      csvStream.on('error', (error) => {
        console.error('CSV stream error:', error);
        // 📝 Log CSV error (only error log)
        this.sendLog({
          method: 'GET',
          url: '/api/drivers/export/csv',
          statusCode: 500,
          operation: 'EXPORT',
          resource: 'DRIVER',
          message: `CSV export failed: ${error.message}`,
          userId,
          metadata: {
            exportFormat: 'CSV',
            driverCount: drivers.length,
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
        // 📝 Log export success (only success log)
        this.sendLog({
          method: 'GET',
          url: '/api/drivers/export/csv',
          statusCode: 200,
          operation: 'EXPORT',
          resource: 'DRIVER',
          message: `CSV export completed successfully`,
          userId,
          metadata: {
            exportFormat: 'CSV',
            driverCount: drivers.length,
          },
          responseTime: Date.now() - startTime,
        });
      });

      csvStream.end();
    } catch (error) {
      console.error('Error in exportToCSV:', error);
      // 📝 Log export error (only error log)
      this.sendLog({
        method: 'GET',
        url: '/api/drivers/export/csv',
        statusCode: 500,
        operation: 'EXPORT',
        resource: 'DRIVER',
        message: `CSV export failed: ${error.message}`,
        userId,
        metadata: {
          exportFormat: 'CSV',
          driverCount: drivers.length,
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
    drivers: Driver[],
    res: Response,
    userId?: string,
  ): Promise<void> {
    const startTime = Date.now();

    try {
      this.logger.log(`Starting XLSX export for ${drivers.length} drivers`);

      const workbook = new ExcelJS.Workbook();
      workbook.creator = 'Driver Management System';
      workbook.created = new Date();

      const worksheet = workbook.addWorksheet('Drivers', {
        pageSetup: {
          orientation: 'landscape',
          fitToPage: true,
          fitToWidth: 1,
        },
      });

      // Define columns with specific widths and styles
      worksheet.columns = [
        { header: 'Name', key: 'name', width: 25 },
        { header: 'Contact No', key: 'contactNo', width: 15 },
        { header: 'Email', key: 'email', width: 30 },
        { header: 'License No', key: 'licenseNo', width: 20 },
        {
          header: 'Aadhaar No',
          key: 'adharNo',
          width: 20,
          style: { numFmt: '@' },
        },
        { header: 'Status', key: 'status', width: 15 },
        {
          header: 'Created At',
          key: 'createdAt',
          width: 20,
          style: { numFmt: 'yyyy-mm-dd hh:mm:ss' },
        },
        {
          header: 'Last Updated',
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
      drivers.forEach((driver) => {
        const row = worksheet.addRow({
          name: driver.name || 'N/A',
          contactNo: driver.contactNo || 'N/A',
          email: driver.email || 'N/A',
          licenseNo: driver.licenseNo || 'N/A',
          adharNo: driver.adharNo || 'N/A',
          status: driver.isActive ? 'Active' : 'Inactive',
          // createdAt: driver.createdAt,
          // updatedAt: driver.updatedAt,
        });

        // Style the data rows
        row.eachCell((cell) => {
          cell.border = {
            top: { style: 'thin' },
            left: { style: 'thin' },
            bottom: { style: 'thin' },
            right: { style: 'thin' },
          };

          // Highlight active drivers
          if (cell.value === 'Active') {
            cell.fill = {
              type: 'pattern',
              pattern: 'solid',
              fgColor: { argb: 'FFC6EFCE' }, // Light green
            };
          } else if (cell.value === 'Inactive') {
            cell.fill = {
              type: 'pattern',
              pattern: 'solid',
              fgColor: { argb: 'FFFFC7CE' }, // Light red
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
        `attachment; filename=drivers_${new Date().toISOString().slice(0, 10)}.xlsx`,
      );

      await workbook.xlsx.write(res);
      res.end();

      // 📝 Log export success (only success log)
      await this.sendLog({
        method: 'GET',
        url: '/api/drivers/export/xlsx',
        statusCode: 200,
        operation: 'EXPORT',
        resource: 'DRIVER',
        message: `XLSX export completed successfully`,
        userId,
        metadata: {
          exportFormat: 'XLSX',
          driverCount: drivers.length,
        },
        responseTime: Date.now() - startTime,
      });

      this.logger.log(`XLSX export completed for ${drivers.length} drivers`);
    } catch (error) {
      console.error('Error exporting to XLSX:', error);

      // 📝 Log export error (only error log)
      await this.sendLog({
        method: 'GET',
        url: '/api/drivers/export/xlsx',
        statusCode: 500,
        operation: 'EXPORT',
        resource: 'DRIVER',
        message: `XLSX export failed: ${error.message}`,
        userId,
        metadata: {
          exportFormat: 'XLSX',
          driverCount: drivers.length,
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
          userAgent: 'driver-service',
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
