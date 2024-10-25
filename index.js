const express = require('express');
require('dotenv').config();
const multer=require('multer');

const { EC2Client } = require('@aws-sdk/client-ec2');
const { DescribeInstancesCommand, ReleaseAddressCommand,DescribeAddressesCommand, AllocateAddressCommand, AssociateAddressCommand } = require('@aws-sdk/client-ec2');
const { sendEmail } = require('./src/services/mail');
const app = express();
const PORT = 3000;
app.use(express.json());
const ec2 = new EC2Client({
  region: process.env.AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID || '<your-access-key-id>',
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || '<your-secret-access-key>',
  },
});
// Fetch running EC2 instance IPs
app.get('/ec2/ips', async (req, res) => {
  try {
    const command = new DescribeInstancesCommand({});
    const instances = await ec2.send(command);
    
    const runningInstances = instances.Reservations.flatMap(r =>
      r.Instances.filter(i => i.State.Name === 'running')
    );

    const ips = runningInstances.map(instance => ({
      instanceId: instance.InstanceId,
      publicIp: instance.PublicIpAddress || 'N/A',
      privateIp: instance.PrivateIpAddress,
    }));
    res.json(ips);
  } catch (error) {
    console.error('Error fetching EC2 IPs:', error);
    res.status(500).send('Failed to fetch EC2 IPs');
  }
});
app.post('/ec2/refresh-ips/:count', async (req, res) => {
  const ipCount = parseInt(req.params.count);

  try {
    // Step 1: Retrieve existing Elastic IPs
    const describeCommand = new DescribeAddressesCommand({});
    const describeResult = await ec2.send(describeCommand);
    
    const existingIps = describeResult.Addresses;
    
    // Step 2: Release existing Elastic IPs 
    if (existingIps.length > 0) {
      const releasePromises = existingIps.map(ip => {
        const releaseCommand = new ReleaseAddressCommand({ AllocationId: ip.AllocationId });
        return ec2.send(releaseCommand);
      });
      await Promise.all(releasePromises); // Wait for all releases to complete
      console.log(`Released existing IPs: ${existingIps.map(ip => ip.PublicIp)}`);
    }

    // Step 3: Allocate new Elastic IPs
    const newIps = [];
    for (let i = 0; i < ipCount; i++) {
      const allocateCommand = new AllocateAddressCommand({});
      const result = await ec2.send(allocateCommand);
      newIps.push(result.PublicIp); // Store newly allocated IPs
    }

    res.json({ message: `Allocated ${ipCount} new Elastic IPs`, newIps });
  } catch (error) {
    console.error('Error refreshing Elastic IPs:', error);
    res.status(500).send('Failed to refresh Elastic IPs');
  }
});
// Refresh EC2 instance IP
app.post('/ec2/refresh-ip/:instanceId', async (req, res) => {
  const instanceId = req.params.instanceId;

  try {
    // Allocate a new Elastic IP
    const allocateCommand = new AllocateAddressCommand({ Domain: 'vpc' });
    const allocation = await ec2.send(allocateCommand);

    // Associate the new IP with the EC2 instance
    const associateParams = {
      InstanceId: instanceId,
      AllocationId: allocation.AllocationId,
    };
    const associateCommand = new AssociateAddressCommand(associateParams);
    await ec2.send(associateCommand);

    res.json({
      message: 'New IP allocated and associated',
      publicIp: allocation.PublicIp,
    });
  } catch (error) {
    console.error('Error refreshing IP:', error);
    res.status(500).send('Failed to refresh IP');
  }
});
const upload = multer(); // Use the multer instance for handling multipart form-data

app.post("/send-email", async (req, res) => {
  try {
    const {
      totalSenders,
      senderFailures,
      totalReceivers,
      receiverFailures,
      responseTime,
    } = await sendEmail(req.body);
    res.status(200).json({
      message: "Emails sent",
      totalSenders,
      senderFailures,
      totalReceivers,
      receiverFailures,
      responseTime,
    });
  } catch (error) {
    console.error("Error sending email:", error);
    res.status(500).json({ message: "Error sending email" });
  }
});

// Start the server
app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
