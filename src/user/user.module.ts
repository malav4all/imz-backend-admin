import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { UserService } from './user.service';
import { UserController } from './user.controller';
import { User, UserSchema } from './schema/user.schema';
import { JwtModule } from '@nestjs/jwt';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: User.name, schema: UserSchema }]),
    JwtModule.register({
      secret:
        process.env.JWT_SECRET ||
        'your-super-secret-jwt-key-change-in-production',
      signOptions: {
        expiresIn: '1h',
      },
    }),
  ],
  controllers: [UserController],
  providers: [UserService],
  exports: [UserService, JwtModule],
})
export class UserModule {}
