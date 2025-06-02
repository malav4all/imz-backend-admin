import {
  Injectable,
  NotFoundException,
  ConflictException,
  UnauthorizedException,
  Logger,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import * as bcrypt from 'bcrypt';
import { JwtService } from '@nestjs/jwt';
import { Response } from 'express';
import * as PDFDocument from 'pdfkit';
import { format } from 'fast-csv';
import * as ExcelJS from 'exceljs';
import axios from 'axios';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { UserQueryDto } from './dto/user-query.dto';
import { User, UserDocument, UserStatus } from './schema/user.schema';
import { PaginatedResponse } from 'src/comman/pagination.dto';
import { LoginDto } from './dto/login.dto';

@Injectable()
export class UserService {
  private readonly logger = new Logger(UserService.name);
  private readonly logsServiceUrl =
    process.env.LOGS_SERVICE_URL || 'http://localhost:3001/logs';

  constructor(
    @InjectModel(User.name) private userModel: Model<UserDocument>,
    private jwtService: JwtService,
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
    ipAddress?: string;
    userAgent?: string;
  }): Promise<void> {
    try {
      await axios.post(
        this.logsServiceUrl,
        {
          ...logData,
          timestamp: new Date(),
          ipAddress: logData.ipAddress || 'internal',
          userAgent: logData.userAgent || 'user-service',
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

  async login(
    loginDto: LoginDto,
    ipAddress?: string,
    userAgent?: string,
  ): Promise<any> {
    const startTime = Date.now();
    const { username, password } = loginDto;

    try {
      // Find user with aggregation to populate related data
      const users = await this.userModel.aggregate([
        {
          $match: {
            username: username,
            status: UserStatus.ACTIVE, // Only allow active users to login
          },
        },
        {
          $lookup: {
            from: 'accounts',
            localField: 'accountId',
            foreignField: '_id',
            as: 'account',
          },
        },
        {
          $lookup: {
            from: 'groups',
            localField: 'groupId',
            foreignField: '_id',
            as: 'group',
          },
        },
        {
          $lookup: {
            from: 'roles',
            localField: 'roleId',
            foreignField: '_id',
            as: 'role',
            pipeline: [{ $project: { name: 1, modulePermissions: 1, _id: 1 } }],
          },
        },
        {
          $addFields: {
            account: { $arrayElemAt: ['$account', 0] },
            group: { $arrayElemAt: ['$group', 0] },
            role: { $arrayElemAt: ['$role', 0] },
            fullName: {
              $concat: [
                '$firstName',
                {
                  $cond: [
                    { $ne: ['$middleName', null] },
                    { $concat: [' ', '$middleName'] },
                    '',
                  ],
                },
                ' ',
                '$lastName',
              ],
            },
          },
        },
        {
          $limit: 1,
        },
      ]);

      if (!users || users.length === 0) {
        await this.sendLog({
          method: 'POST',
          url: '/auth/login',
          statusCode: 401,
          operation: 'USER_LOGIN',
          resource: 'users',
          message: 'Login failed - invalid username',
          metadata: {
            username,
            reason: 'username_not_found',
          },
          responseTime: Date.now() - startTime,
          isError: true,
          errorMessage: 'Invalid username',
          ipAddress,
          userAgent,
        });

        throw new UnauthorizedException('Invalid username');
      }

      const user = users[0];

      // Verify password
      const isPasswordValid = await bcrypt.compare(password, user.password);
      if (!isPasswordValid) {
        await this.sendLog({
          method: 'POST',
          url: '/auth/login',
          statusCode: 401,
          operation: 'USER_LOGIN',
          resource: 'users',
          message: 'Login failed - invalid password',
          userId: user._id.toString(),
          metadata: {
            username,
            userId: user._id.toString(),
            reason: 'invalid_password',
          },
          responseTime: Date.now() - startTime,
          isError: true,
          errorMessage: 'Invalid password',
          ipAddress,
          userAgent,
        });

        throw new UnauthorizedException('Invalid password');
      }

      // Check if user has a role assigned
      if (!user.role) {
        await this.sendLog({
          method: 'POST',
          url: '/auth/login',
          statusCode: 401,
          operation: 'USER_LOGIN',
          resource: 'users',
          message: 'Login failed - no role assigned',
          userId: user._id.toString(),
          metadata: {
            username,
            userId: user._id.toString(),
            reason: 'no_role_assigned',
          },
          responseTime: Date.now() - startTime,
          isError: true,
          errorMessage: 'User has no role assigned',
          ipAddress,
          userAgent,
        });

        throw new UnauthorizedException('User has no role assigned');
      }

      // Generate JWT token
      const payload = {
        sub: user._id.toString(),
        username: user.username,
        email: user.email,
        roleId: user.roleId?.toString(),
        roleName: user.role?.name,
        permissions: user.role?.permissions || [],
        accountId: user.accountId?.toString(),
        groupId: user.groupId?.toString(),
      };

      const accessToken = this.jwtService.sign(payload);
      const expiresIn = 3600; // 1 hour in seconds

      // Prepare response (exclude password)
      const userResponse = {
        id: user._id.toString(),
        username: user.username,
        firstName: user.firstName,
        middleName: user.middleName,
        lastName: user.lastName,
        fullName: user.fullName,
        email: user.email,
        contactNo: user.contactNo,
        type: user.type,
        status: user.status,
        account: user.account,
        group: user.group,
        role: user.role,
      };

      await this.sendLog({
        method: 'POST',
        url: '/auth/login',
        statusCode: 200,
        operation: 'USER_LOGIN',
        resource: 'users',
        message: 'User logged in successfully',
        userId: user._id.toString(),
        metadata: {
          username,
          userId: user._id.toString(),
          userEmail: user.email,
          roleName: user.role?.name,
          accountName: user.account?.accountName,
          groupName: user.group?.groupName,
          tokenExpiresIn: expiresIn,
        },
        responseTime: Date.now() - startTime,
        ipAddress,
        userAgent,
      });

      return {
        user: userResponse,
        accessToken,
        tokenType: 'Bearer',
        expiresIn,
      };
    } catch (error) {
      if (!(error instanceof UnauthorizedException)) {
        await this.sendLog({
          method: 'POST',
          url: '/auth/login',
          statusCode: 500,
          operation: 'USER_LOGIN',
          resource: 'users',
          message: 'Login failed with unexpected error',
          metadata: {
            username,
          },
          responseTime: Date.now() - startTime,
          isError: true,
          errorMessage: error.message,
          stackTrace: error.stack,
          ipAddress,
          userAgent,
        });
      }
      throw error;
    }
  }

  async validateUser(userId: string): Promise<any> {
    const startTime = Date.now();

    try {
      if (!Types.ObjectId.isValid(userId)) {
        await this.sendLog({
          method: 'GET',
          url: '/auth/validate',
          statusCode: 400,
          operation: 'VALIDATE_USER',
          resource: 'users',
          message: 'User validation failed - invalid user ID format',
          metadata: { userId },
          responseTime: Date.now() - startTime,
          isError: true,
          errorMessage: 'Invalid user ID format',
        });
        return null;
      }

      const users = await this.userModel.aggregate([
        {
          $match: {
            _id: new Types.ObjectId(userId),
            status: UserStatus.ACTIVE, // Only validate active users
          },
        },
        {
          $lookup: {
            from: 'accounts',
            localField: 'accountId',
            foreignField: '_id',
            as: 'account',
            pipeline: [{ $project: { accountName: 1, _id: 1 } }],
          },
        },
        {
          $lookup: {
            from: 'groups',
            localField: 'groupId',
            foreignField: '_id',
            as: 'group',
            pipeline: [{ $project: { groupName: 1, _id: 1 } }],
          },
        },
        {
          $lookup: {
            from: 'roles',
            localField: 'roleId',
            foreignField: '_id',
            as: 'role',
            pipeline: [{ $project: { name: 1, modulePermissions: 1, _id: 1 } }],
          },
        },
        {
          $addFields: {
            account: { $arrayElemAt: ['$account', 0] },
            group: { $arrayElemAt: ['$group', 0] },
            role: { $arrayElemAt: ['$role', 0] },
            fullName: {
              $concat: [
                '$firstName',
                {
                  $cond: [
                    { $ne: ['$middleName', null] },
                    { $concat: [' ', '$middleName'] },
                    '',
                  ],
                },
                ' ',
                '$lastName',
              ],
            },
          },
        },
        {
          $project: {
            password: 0, // Exclude password from response
          },
        },
        {
          $limit: 1,
        },
      ]);

      if (!users || users.length === 0) {
        await this.sendLog({
          method: 'GET',
          url: '/auth/validate',
          statusCode: 404,
          operation: 'VALIDATE_USER',
          resource: 'users',
          message: 'User validation failed - user not found',
          metadata: { userId },
          responseTime: Date.now() - startTime,
          isError: true,
          errorMessage: 'User not found or inactive',
        });
        return null;
      }

      const user = users[0];

      // Check if user has a role assigned (important for authorization)
      if (!user.role) {
        await this.sendLog({
          method: 'GET',
          url: '/auth/validate',
          statusCode: 401,
          operation: 'VALIDATE_USER',
          resource: 'users',
          message: 'User validation failed - no role assigned',
          userId,
          metadata: { userId, username: user.username },
          responseTime: Date.now() - startTime,
          isError: true,
          errorMessage: 'User has no role assigned',
        });
        return null;
      }

      await this.sendLog({
        method: 'GET',
        url: '/auth/validate',
        statusCode: 200,
        operation: 'VALIDATE_USER',
        resource: 'users',
        message: 'User validated successfully',
        userId,
        metadata: {
          userId,
          username: user.username,
          roleName: user.role?.name,
        },
        responseTime: Date.now() - startTime,
      });

      return user;
    } catch (error) {
      await this.sendLog({
        method: 'GET',
        url: '/auth/validate',
        statusCode: 500,
        operation: 'VALIDATE_USER',
        resource: 'users',
        message: 'User validation failed with unexpected error',
        metadata: { userId },
        responseTime: Date.now() - startTime,
        isError: true,
        errorMessage: error.message,
        stackTrace: error.stack,
      });

      // Log error if needed
      console.error('Error validating user:', error);
      return null;
    }
  }

  async create(createUserDto: CreateUserDto, userId?: string): Promise<User> {
    const startTime = Date.now();

    try {
      // Check if username or email already exists
      const existingUser = await this.userModel.findOne({
        $or: [
          { username: createUserDto.username },
          { email: createUserDto.email },
        ],
      });

      if (existingUser) {
        await this.sendLog({
          method: 'POST',
          url: '/users',
          statusCode: 409,
          operation: 'CREATE_USER',
          resource: 'users',
          message: 'User creation failed - username or email already exists',
          userId,
          metadata: {
            requestedUsername: createUserDto.username,
            requestedEmail: createUserDto.email,
            conflictingField:
              existingUser.username === createUserDto.username
                ? 'username'
                : 'email',
          },
          responseTime: Date.now() - startTime,
          isError: true,
          errorMessage: 'Username or email already exists',
        });

        throw new ConflictException('Username or email already exists');
      }

      // Hash password
      const saltRounds = 10;
      const hashedPassword = await bcrypt.hash(
        createUserDto.password,
        saltRounds,
      );

      const userData = {
        ...createUserDto,
        password: hashedPassword,
        accountId: createUserDto.accountId
          ? new Types.ObjectId(createUserDto.accountId)
          : undefined,
        groupId: createUserDto.groupId
          ? new Types.ObjectId(createUserDto.groupId)
          : undefined,
        roleId: new Types.ObjectId(createUserDto.roleId),
      };

      const createdUser = new this.userModel(userData);
      const savedUser: any = await createdUser.save();

      await this.sendLog({
        method: 'POST',
        url: '/users',
        statusCode: 201,
        operation: 'CREATE_USER',
        resource: 'users',
        message: 'User created successfully',
        userId,
        metadata: {
          createdUserId: savedUser._id.toString(),
          username: savedUser.username,
          email: savedUser.email,
          firstName: savedUser.firstName,
          lastName: savedUser.lastName,
          // type: savedUser.type,
          status: savedUser.status,
          roleId: createUserDto.roleId,
          accountId: createUserDto.accountId,
          groupId: createUserDto.groupId,
        },
        responseTime: Date.now() - startTime,
      });

      return savedUser;
    } catch (error) {
      if (!(error instanceof ConflictException)) {
        await this.sendLog({
          method: 'POST',
          url: '/users',
          statusCode: 500,
          operation: 'CREATE_USER',
          resource: 'users',
          message: 'User creation failed with unexpected error',
          userId,
          metadata: {
            userData: { ...createUserDto, password: '[REDACTED]' },
          },
          responseTime: Date.now() - startTime,
          isError: true,
          errorMessage: error.message,
          stackTrace: error.stack,
        });
      }
      throw error;
    }
  }

  async findAll(
    queryDto: UserQueryDto,
    userId?: string,
  ): Promise<PaginatedResponse<any>> {
    const startTime = Date.now();

    try {
      const {
        page = 1,
        limit = 10,
        search,
        status,
        accountId,
        groupId,
      } = queryDto;
      const skip = (page - 1) * limit;

      // Build match conditions
      const matchConditions: any = {};

      if (search) {
        matchConditions.$or = [
          { username: { $regex: search, $options: 'i' } },
          { firstName: { $regex: search, $options: 'i' } },
          { lastName: { $regex: search, $options: 'i' } },
          { email: { $regex: search, $options: 'i' } },
        ];
      }

      if (status) matchConditions.status = status;
      if (accountId) matchConditions.accountId = new Types.ObjectId(accountId);
      if (groupId) matchConditions.groupId = new Types.ObjectId(groupId);

      const aggregationPipeline: any = [
        { $match: matchConditions },
        {
          $lookup: {
            from: 'accounts',
            localField: 'accountId',
            foreignField: '_id',
            as: 'account',
            pipeline: [{ $project: { accountName: 1, _id: 1 } }],
          },
        },
        {
          $lookup: {
            from: 'groups',
            localField: 'groupId',
            foreignField: '_id',
            as: 'group',
            pipeline: [{ $project: { groupName: 1, _id: 1 } }],
          },
        },
        {
          $lookup: {
            from: 'roles',
            localField: 'roleId',
            foreignField: '_id',
            as: 'role',
            pipeline: [{ $project: { name: 1, permissions: 1, _id: 1 } }],
          },
        },
        {
          $addFields: {
            account: { $arrayElemAt: ['$account', 0] },
            group: { $arrayElemAt: ['$group', 0] },
            role: { $arrayElemAt: ['$role', 0] },
            fullName: {
              $concat: [
                '$firstName',
                {
                  $cond: [
                    { $ne: ['$middleName', null] },
                    { $concat: [' ', '$middleName'] },
                    '',
                  ],
                },
                ' ',
                '$lastName',
              ],
            },
          },
        },
        {
          $project: {
            password: 0,
          },
        },
        { $sort: { createdAt: -1 } },
      ];

      // Get total count
      const totalPipeline = [{ $match: matchConditions }, { $count: 'total' }];

      const [users, totalResult] = await Promise.all([
        this.userModel.aggregate([
          ...aggregationPipeline,
          { $skip: skip },
          { $limit: limit },
        ]),
        this.userModel.aggregate(totalPipeline),
      ]);

      const total = totalResult[0]?.total || 0;
      const result = new PaginatedResponse(users, page, limit, total);

      await this.sendLog({
        method: 'GET',
        url: '/users',
        statusCode: 200,
        operation: 'LIST_USERS',
        resource: 'users',
        message: 'Users retrieved successfully',
        userId,
        metadata: {
          page,
          limit,
          total,
          resultCount: users.length,
          searchTerm: search,
          filters: { status, accountId, groupId },
          hasFilters: !!(search || status || accountId || groupId),
        },
        responseTime: Date.now() - startTime,
      });

      return result;
    } catch (error) {
      await this.sendLog({
        method: 'GET',
        url: '/users',
        statusCode: 500,
        operation: 'LIST_USERS',
        resource: 'users',
        message: 'Failed to retrieve users',
        userId,
        metadata: {
          query: queryDto,
        },
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
          url: `/users/${id}`,
          statusCode: 400,
          operation: 'GET_USER',
          resource: 'users',
          message: 'Invalid user ID format',
          userId,
          metadata: { requestedUserId: id },
          responseTime: Date.now() - startTime,
          isError: true,
          errorMessage: 'Invalid user ID',
        });

        throw new NotFoundException('Invalid user ID');
      }

      const users = await this.userModel.aggregate([
        { $match: { _id: new Types.ObjectId(id) } },
        {
          $lookup: {
            from: 'accounts',
            localField: 'accountId',
            foreignField: '_id',
            as: 'account',
            pipeline: [{ $project: { name: 1, _id: 1 } }],
          },
        },
        {
          $lookup: {
            from: 'groups',
            localField: 'groupId',
            foreignField: '_id',
            as: 'group',
            pipeline: [{ $project: { name: 1, _id: 1 } }],
          },
        },
        {
          $addFields: {
            account: { $arrayElemAt: ['$account', 0] },
            group: { $arrayElemAt: ['$group', 0] },
            role: { $arrayElemAt: ['$role', 0] },
            fullName: {
              $concat: [
                '$firstName',
                {
                  $cond: [
                    { $ne: ['$middleName', null] },
                    { $concat: [' ', '$middleName'] },
                    '',
                  ],
                },
                ' ',
                '$lastName',
              ],
            },
          },
        },
        {
          $project: {
            password: 0, // Exclude password from response
          },
        },
      ]);

      if (!users || users.length === 0) {
        await this.sendLog({
          method: 'GET',
          url: `/users/${id}`,
          statusCode: 404,
          operation: 'GET_USER',
          resource: 'users',
          message: 'User not found',
          userId,
          metadata: { requestedUserId: id },
          responseTime: Date.now() - startTime,
          isError: true,
          errorMessage: 'User not found',
        });

        throw new NotFoundException('User not found');
      }

      const user = users[0];

      await this.sendLog({
        method: 'GET',
        url: `/users/${id}`,
        statusCode: 200,
        operation: 'GET_USER',
        resource: 'users',
        message: 'User retrieved successfully',
        userId,
        metadata: {
          requestedUserId: id,
          foundUsername: user.username,
          foundUserEmail: user.email,
          foundUserStatus: user.status,
        },
        responseTime: Date.now() - startTime,
      });

      return user;
    } catch (error) {
      if (!(error instanceof NotFoundException)) {
        await this.sendLog({
          method: 'GET',
          url: `/users/${id}`,
          statusCode: 500,
          operation: 'GET_USER',
          resource: 'users',
          message: 'Unexpected error while retrieving user',
          userId,
          metadata: { requestedUserId: id },
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
    updateUserDto: UpdateUserDto,
    userId?: string,
  ): Promise<any> {
    const startTime = Date.now();

    try {
      if (!Types.ObjectId.isValid(id)) {
        await this.sendLog({
          method: 'PATCH',
          url: `/users/${id}`,
          statusCode: 400,
          operation: 'UPDATE_USER',
          resource: 'users',
          message: 'Invalid user ID format',
          userId,
          metadata: { targetUserId: id, updateData: updateUserDto },
          responseTime: Date.now() - startTime,
          isError: true,
          errorMessage: 'Invalid user ID',
        });

        throw new NotFoundException('Invalid user ID');
      }

      // Check if username or email already exists (excluding current user)
      if (updateUserDto.username || updateUserDto.email) {
        const conditions: any[] = [];
        if (updateUserDto.username) {
          conditions.push({ username: updateUserDto.username });
        }
        if (updateUserDto.email) {
          conditions.push({ email: updateUserDto.email });
        }

        const existingUser = await this.userModel.findOne({
          $and: [{ _id: { $ne: new Types.ObjectId(id) } }, { $or: conditions }],
        });

        if (existingUser) {
          await this.sendLog({
            method: 'PATCH',
            url: `/users/${id}`,
            statusCode: 409,
            operation: 'UPDATE_USER',
            resource: 'users',
            message: 'User update failed - username or email already exists',
            userId,
            metadata: {
              targetUserId: id,
              updateData: updateUserDto,
              conflictingUsername: updateUserDto.username,
              conflictingEmail: updateUserDto.email,
            },
            responseTime: Date.now() - startTime,
            isError: true,
            errorMessage: 'Username or email already exists',
          });

          throw new ConflictException('Username or email already exists');
        }
      }

      const updateData = {
        ...updateUserDto,
        accountId: updateUserDto.accountId
          ? new Types.ObjectId(updateUserDto.accountId)
          : undefined,
        groupId: updateUserDto.groupId
          ? new Types.ObjectId(updateUserDto.groupId)
          : undefined,
        roleId: updateUserDto.roleId
          ? new Types.ObjectId(updateUserDto.roleId)
          : undefined,
      };

      const updatedUser: any = await this.userModel.findByIdAndUpdate(
        id,
        updateData,
        {
          new: true,
          runValidators: true,
        },
      );

      if (!updatedUser) {
        await this.sendLog({
          method: 'PATCH',
          url: `/users/${id}`,
          statusCode: 404,
          operation: 'UPDATE_USER',
          resource: 'users',
          message: 'User not found for update',
          userId,
          metadata: { targetUserId: id, updateData: updateUserDto },
          responseTime: Date.now() - startTime,
          isError: true,
          errorMessage: 'User not found',
        });

        throw new NotFoundException('User not found');
      }

      const result = await this.findOne(id);

      await this.sendLog({
        method: 'PATCH',
        url: `/users/${id}`,
        statusCode: 200,
        operation: 'UPDATE_USER',
        resource: 'users',
        message: 'User updated successfully',
        userId,
        metadata: {
          targetUserId: id,
          updatedUsername: updatedUser.username,
          updatedEmail: updatedUser.email,
          updateData: {
            ...updateUserDto,
            // password: updateUserDto.password ? '[REDACTED]' : undefined,
          },
          fieldsUpdated: Object.keys(updateUserDto),
        },
        responseTime: Date.now() - startTime,
      });

      return result;
    } catch (error) {
      if (
        !(error instanceof NotFoundException) &&
        !(error instanceof ConflictException)
      ) {
        await this.sendLog({
          method: 'PATCH',
          url: `/users/${id}`,
          statusCode: 500,
          operation: 'UPDATE_USER',
          resource: 'users',
          message: 'Unexpected error while updating user',
          userId,
          metadata: { targetUserId: id, updateData: updateUserDto },
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
          url: `/users/${id}`,
          statusCode: 400,
          operation: 'DELETE_USER',
          resource: 'users',
          message: 'Invalid user ID format',
          userId,
          metadata: { targetUserId: id },
          responseTime: Date.now() - startTime,
          isError: true,
          errorMessage: 'Invalid user ID',
        });

        throw new NotFoundException('Invalid user ID');
      }

      const result = await this.userModel.findByIdAndDelete(id);

      if (!result) {
        await this.sendLog({
          method: 'DELETE',
          url: `/users/${id}`,
          statusCode: 404,
          operation: 'DELETE_USER',
          resource: 'users',
          message: 'User not found for deletion',
          userId,
          metadata: { targetUserId: id },
          responseTime: Date.now() - startTime,
          isError: true,
          errorMessage: 'User not found',
        });

        throw new NotFoundException('User not found');
      }

      await this.sendLog({
        method: 'DELETE',
        url: `/users/${id}`,
        statusCode: 200,
        operation: 'DELETE_USER',
        resource: 'users',
        message: 'User deleted successfully',
        userId,
        metadata: {
          deletedUserId: id,
          deletedUsername: result.username,
          deletedUserEmail: result.email,
          deletedUserStatus: result.status,
        },
        responseTime: Date.now() - startTime,
      });
    } catch (error) {
      if (!(error instanceof NotFoundException)) {
        await this.sendLog({
          method: 'DELETE',
          url: `/users/${id}`,
          statusCode: 500,
          operation: 'DELETE_USER',
          resource: 'users',
          message: 'Unexpected error while deleting user',
          userId,
          metadata: { targetUserId: id },
          responseTime: Date.now() - startTime,
          isError: true,
          errorMessage: error.message,
          stackTrace: error.stack,
        });
      }
      throw error;
    }
  }

  async updatePassword(
    id: string,
    newPassword: string,
    userId?: string,
  ): Promise<void> {
    const startTime = Date.now();

    try {
      if (!Types.ObjectId.isValid(id)) {
        await this.sendLog({
          method: 'PATCH',
          url: `/users/${id}/password`,
          statusCode: 400,
          operation: 'UPDATE_USER_PASSWORD',
          resource: 'users',
          message: 'Invalid user ID format',
          userId,
          metadata: { targetUserId: id },
          responseTime: Date.now() - startTime,
          isError: true,
          errorMessage: 'Invalid user ID',
        });

        throw new NotFoundException('Invalid user ID');
      }

      const saltRounds = 10;
      const hashedPassword = await bcrypt.hash(newPassword, saltRounds);

      const result = await this.userModel.findByIdAndUpdate(
        id,
        { password: hashedPassword },
        { new: true },
      );

      if (!result) {
        await this.sendLog({
          method: 'PATCH',
          url: `/users/${id}/password`,
          statusCode: 404,
          operation: 'UPDATE_USER_PASSWORD',
          resource: 'users',
          message: 'User not found for password update',
          userId,
          metadata: { targetUserId: id },
          responseTime: Date.now() - startTime,
          isError: true,
          errorMessage: 'User not found',
        });

        throw new NotFoundException('User not found');
      }

      await this.sendLog({
        method: 'PATCH',
        url: `/users/${id}/password`,
        statusCode: 200,
        operation: 'UPDATE_USER_PASSWORD',
        resource: 'users',
        message: 'User password updated successfully',
        userId,
        metadata: {
          targetUserId: id,
          targetUsername: result.username,
        },
        responseTime: Date.now() - startTime,
      });
    } catch (error) {
      if (!(error instanceof NotFoundException)) {
        await this.sendLog({
          method: 'PATCH',
          url: `/users/${id}/password`,
          statusCode: 500,
          operation: 'UPDATE_USER_PASSWORD',
          resource: 'users',
          message: 'Unexpected error while updating password',
          userId,
          metadata: { targetUserId: id },
          responseTime: Date.now() - startTime,
          isError: true,
          errorMessage: error.message,
          stackTrace: error.stack,
        });
      }
      throw error;
    }
  }

  async findAllWithoutPagination(userId?: string): Promise<any[]> {
    const startTime = Date.now();

    try {
      const users = await this.userModel.aggregate([
        {
          $lookup: {
            from: 'accounts',
            localField: 'accountId',
            foreignField: '_id',
            as: 'account',
            pipeline: [{ $project: { accountName: 1, _id: 1 } }],
          },
        },
        {
          $lookup: {
            from: 'groups',
            localField: 'groupId',
            foreignField: '_id',
            as: 'group',
            pipeline: [{ $project: { groupName: 1, _id: 1 } }],
          },
        },
        {
          $lookup: {
            from: 'roles',
            localField: 'roleId',
            foreignField: '_id',
            as: 'role',
            pipeline: [{ $project: { name: 1, _id: 1 } }],
          },
        },
        {
          $addFields: {
            account: { $arrayElemAt: ['$account', 0] },
            group: { $arrayElemAt: ['$group', 0] },
            role: { $arrayElemAt: ['$role', 0] },
            fullName: {
              $concat: [
                '$firstName',
                {
                  $cond: [
                    { $ne: ['$middleName', null] },
                    { $concat: [' ', '$middleName'] },
                    '',
                  ],
                },
                ' ',
                '$lastName',
              ],
            },
          },
        },
        {
          $project: {
            password: 0, // Exclude password from response
          },
        },
        { $sort: { createdAt: -1 } },
      ]);

      await this.sendLog({
        method: 'GET',
        url: '/users/export/data',
        statusCode: 200,
        operation: 'EXPORT_USERS_DATA',
        resource: 'users',
        message: 'Users export data retrieved successfully',
        userId,
        metadata: {
          totalUsers: users.length,
        },
        responseTime: Date.now() - startTime,
      });

      return users;
    } catch (error) {
      await this.sendLog({
        method: 'GET',
        url: '/users/export/data',
        statusCode: 500,
        operation: 'EXPORT_USERS_DATA',
        resource: 'users',
        message: 'Failed to retrieve users export data',
        userId,
        responseTime: Date.now() - startTime,
        isError: true,
        errorMessage: error.message,
        stackTrace: error.stack,
      });

      throw error;
    }
  }

  exportToPDF(users: any[], res: Response, userId?: string): void {
    const startTime = Date.now();

    try {
      // Create a document with smaller margins and landscape orientation
      const doc = new PDFDocument({
        margin: 20,
        size: 'A4',
        layout: 'landscape', // This gives us more width
      });

      // Set response headers for PDF download
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', 'attachment; filename=users.pdf');

      doc.pipe(res);

      // Title
      doc.fontSize(16).text('User List', { align: 'center' }).moveDown(1);

      // Calculate available width
      const pageWidth =
        doc.page.width - (doc.page.margins.left + doc.page.margins.right);

      // Define table structure with better width distribution
      const table = {
        headers: [
          { label: 'Username', width: pageWidth * 0.1 }, // 10%
          { label: 'Full Name', width: pageWidth * 0.2 }, // 20%
          { label: 'Email', width: pageWidth * 0.1 }, // 10%
          { label: 'Contact No', width: pageWidth * 0.1 }, // 10%
          { label: 'Status', width: pageWidth * 0.1 }, // 10%
          { label: 'Role', width: pageWidth * 0.1 }, // 10%
          { label: 'Account', width: pageWidth * 0.1 }, // 10%
          { label: 'Group', width: pageWidth * 0.1 }, // 10%
        ],
        rows: users.map((user) => [
          user.username || '',
          user.fullName || '',
          user.email || '',
          user.contactNo || '',
          user.status || '',
          user.role?.name || '',
          user.account?.accountName || '',
          user.group?.groupName || '',
        ]),
        rowHeight: 20,
        margin: { top: 30 },
      };

      // Table drawing position
      const startY = doc.y + table.margin.top;
      let currentY = startY;

      // Draw table headers with background
      doc.font('Helvetica-Bold').fontSize(9);
      let x = doc.page.margins.left;

      // Draw header background
      doc
        .rect(doc.page.margins.left, currentY - 2, pageWidth, table.rowHeight)
        .fill('#f0f0f0')
        .stroke();

      // Reset color for text
      doc.fillColor('black');

      table.headers.forEach((header, i) => {
        doc.text(header.label, x + 2, currentY + 3, {
          width: header.width - 4,
          align: 'left',
          ellipsis: true, // Add ellipsis if text is too long
        });
        x += header.width;
      });

      currentY += table.rowHeight + 5;

      // Draw horizontal line under headers
      doc
        .moveTo(doc.page.margins.left, currentY - 3)
        .lineTo(doc.page.margins.left + pageWidth, currentY - 3)
        .stroke();

      // Draw table rows
      doc.font('Helvetica').fontSize(8);

      table.rows.forEach((row, rowIndex) => {
        // Check if we need a new page
        if (currentY > doc.page.height - doc.page.margins.bottom - 30) {
          doc.addPage();
          currentY = doc.page.margins.top;

          // Redraw headers on new page
          doc.font('Helvetica-Bold').fontSize(9);
          let headerX = doc.page.margins.left;

          doc
            .rect(
              doc.page.margins.left,
              currentY - 2,
              pageWidth,
              table.rowHeight,
            )
            .fill('#f0f0f0')
            .stroke();

          doc.fillColor('black');

          table.headers.forEach((header, i) => {
            doc.text(header.label, headerX + 2, currentY + 3, {
              width: header.width - 4,
              align: 'left',
              ellipsis: true,
            });
            headerX += header.width;
          });

          currentY += table.rowHeight + 5;
          doc.font('Helvetica').fontSize(8);
        }

        x = doc.page.margins.left;

        // Alternate row colors
        if (rowIndex % 2 === 0) {
          doc
            .rect(
              doc.page.margins.left,
              currentY - 2,
              pageWidth,
              table.rowHeight,
            )
            .fill('#f9f9f9')
            .stroke();
          doc.fillColor('black');
        }

        // Draw each cell in the row
        row.forEach((cell, colIndex) => {
          doc.text(String(cell), x + 2, currentY + 2, {
            width: table.headers[colIndex].width - 4,
            height: table.rowHeight - 4,
            align: 'left',
            ellipsis: true, // Truncate with ellipsis if too long
          });
          x += table.headers[colIndex].width;
        });

        currentY += table.rowHeight;
      });

      // Add footer with page numbers
      const pages = doc.bufferedPageRange();
      for (let i = 0; i < pages.count; i++) {
        doc.switchToPage(i);
        doc
          .fontSize(8)
          .text(
            `Page ${i + 1} of ${pages.count}`,
            doc.page.margins.left,
            doc.page.height - doc.page.margins.bottom + 10,
            { align: 'center' },
          );
      }

      doc.end();

      // Log successful PDF export
      this.sendLog({
        method: 'GET',
        url: '/users/export/pdf',
        statusCode: 200,
        operation: 'EXPORT_USERS_PDF',
        resource: 'users',
        message: 'Users list exported to PDF successfully',
        userId,
        metadata: {
          totalUsers: users.length,
          exportFormat: 'PDF',
        },
        responseTime: Date.now() - startTime,
      });
    } catch (error) {
      console.error('Error in exportToPDF:', error);

      this.sendLog({
        method: 'GET',
        url: '/users/export/pdf',
        statusCode: 500,
        operation: 'EXPORT_USERS_PDF',
        resource: 'users',
        message: 'Failed to export users list to PDF',
        userId,
        metadata: {
          totalUsers: users.length,
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

  exportToCSV(users: any[], res: Response, userId?: string): void {
    const startTime = Date.now();

    try {
      // Set response headers
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader(
        'Content-Disposition',
        'attachment; filename=users_' +
          new Date().toISOString().slice(0, 10) +
          '.csv',
      );

      // CSV configuration
      const csvStream = format({
        headers: [
          'Username',
          'Full Name',
          'First Name',
          'Last Name',
          'Email',
          'Contact No',
          'Type',
          'Status',
          'Account',
          'Group',
          'Role',
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
      users.forEach((user) => {
        csvStream.write({
          Username: user.username || 'N/A',
          'Full Name': user.fullName || 'N/A',
          'First Name': user.firstName || 'N/A',
          'Last Name': user.lastName || 'N/A',
          Email: user.email || 'N/A',
          'Contact No': user.contactNo || 'N/A',
          Type: user.type || 'N/A',
          Status: user.status ? user.status.toUpperCase() : 'UNKNOWN',
          Account: user.account?.accountName || 'N/A',
          Group: user.group?.groupName || 'N/A',
          Role: user.role?.name || 'N/A',
        });
      });

      // Handle stream events
      csvStream.on('error', (error) => {
        console.error('CSV stream error:', error);

        this.sendLog({
          method: 'GET',
          url: '/users/export/csv',
          statusCode: 500,
          operation: 'EXPORT_USERS_CSV',
          resource: 'users',
          message: 'CSV stream error during export',
          userId,
          metadata: {
            totalUsers: users.length,
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
          url: '/users/export/csv',
          statusCode: 200,
          operation: 'EXPORT_USERS_CSV',
          resource: 'users',
          message: 'Users list exported to CSV successfully',
          userId,
          metadata: {
            totalUsers: users.length,
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
        url: '/users/export/csv',
        statusCode: 500,
        operation: 'EXPORT_USERS_CSV',
        resource: 'users',
        message: 'Failed to export users list to CSV',
        userId,
        metadata: {
          totalUsers: users.length,
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
    users: any[],
    res: Response,
    userId?: string,
  ): Promise<void> {
    const startTime = Date.now();

    try {
      const workbook = new ExcelJS.Workbook();
      workbook.creator = 'User Management System';
      workbook.created = new Date();

      const worksheet = workbook.addWorksheet('Users', {
        pageSetup: {
          orientation: 'landscape',
          fitToPage: true,
          fitToWidth: 1,
        },
      });

      // Define columns with specific widths and styles
      worksheet.columns = [
        {
          header: 'Username',
          key: 'username',
          width: 20,
          style: { numFmt: '@' },
        },
        { header: 'Full Name', key: 'fullName', width: 25 },
        { header: 'First Name', key: 'firstName', width: 20 },
        { header: 'Last Name', key: 'lastName', width: 20 },
        { header: 'Email', key: 'email', width: 30 },
        { header: 'Contact No', key: 'contactNo', width: 15 },
        { header: 'Type', key: 'type', width: 15 },
        { header: 'Status', key: 'status', width: 15 },
        { header: 'Account', key: 'account', width: 20 },
        { header: 'Group', key: 'group', width: 20 },
        { header: 'Role', key: 'role', width: 20 },
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
      users.forEach((user) => {
        const row = worksheet.addRow({
          username: user.username || 'N/A',
          fullName: user.fullName || 'N/A',
          firstName: user.firstName || 'N/A',
          lastName: user.lastName || 'N/A',
          email: user.email || 'N/A',
          contactNo: user.contactNo || 'N/A',
          type: user.type || 'N/A',
          status: user.status ? user.status.toUpperCase() : 'UNKNOWN',
          account: user.account?.accountName || 'N/A',
          group: user.group?.groupName || 'N/A',
          role: user.role?.name || 'N/A',
          createdAt: user.createdAt,
          updatedAt: user.updatedAt,
        });

        // Style the data rows
        row.eachCell((cell) => {
          cell.border = {
            top: { style: 'thin' },
            left: { style: 'thin' },
            bottom: { style: 'thin' },
            right: { style: 'thin' },
          };

          // Highlight active users
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
        `attachment; filename=users_${new Date().toISOString().slice(0, 10)}.xlsx`,
      );

      await workbook.xlsx.write(res);
      res.end();

      await this.sendLog({
        method: 'GET',
        url: '/users/export/xlsx',
        statusCode: 200,
        operation: 'EXPORT_USERS_XLSX',
        resource: 'users',
        message: 'Users list exported to XLSX successfully',
        userId,
        metadata: {
          totalUsers: users.length,
          exportFormat: 'XLSX',
        },
        responseTime: Date.now() - startTime,
      });
    } catch (error) {
      console.error('Error exporting to XLSX:', error);

      await this.sendLog({
        method: 'GET',
        url: '/users/export/xlsx',
        statusCode: 500,
        operation: 'EXPORT_USERS_XLSX',
        resource: 'users',
        message: 'Failed to export users list to XLSX',
        userId,
        metadata: {
          totalUsers: users.length,
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
}
